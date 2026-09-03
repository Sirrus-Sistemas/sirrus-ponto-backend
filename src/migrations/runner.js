import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_NAME = process.env.DB_NAME || 'ponto_web';

async function runMigrations() {
  // Conexão sem database para poder criar o banco
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  console.log('🔌 Conectado ao MariaDB');

  // Garante que o banco existe antes de qualquer checagem — num banco
  // totalmente novo isso normalmente é feito pela própria migration 001,
  // mas schema_migrations precisa existir antes do loop de migrations,
  // que roda antes dela.
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  // Lê todos os arquivos .sql ordenados
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // schema_migrations registra quais arquivos já foram executados, para que
  // rodar `npm run migrate` de novo nunca reexecute uma migration já
  // aplicada. Isso é essencial para migrations que não são DDL puro — um
  // CREATE TABLE/ADD COLUMN falha (e é ignorado) na segunda execução, mas
  // um UPDATE em massa não falha, ele simplesmente aplica de novo por
  // cima de dados que já estão corretos (foi exatamente isso que corrompeu
  // as batidas de relógio ao rodar a migration 035 duas vezes).
  const [existingTables] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
    [DB_NAME],
  );
  const bancoJaTinhaSchema = existingTables[0].total > 0;

  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${DB_NAME}\`.schema_migrations (
       filename   VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  if (bancoJaTinhaSchema) {
    // Banco pré-existente (ex.: produção) migrando de um runner sem
    // controle para este: o schema de todas as migrations atuais já está
    // aplicado, só faltava o registro. Marca todas como aplicadas SEM
    // reexecutar — reexecutar reaplicaria migrations não-idempotentes
    // (como a 035) sobre dados que já estão corretos.
    const [jaRegistradas] = await conn.query(
      `SELECT filename FROM \`${DB_NAME}\`.schema_migrations`,
    );
    const registradas = new Set(jaRegistradas.map((r) => r.filename));
    const novas = files.filter((f) => !registradas.has(f));

    if (novas.length > 0) {
      console.log(`⚙️  Registrando ${novas.length} migration(s) existente(s) como já aplicada(s) (schema pré-existente, sem reexecutar)...`);
      for (const file of novas) {
        await conn.query(`INSERT IGNORE INTO \`${DB_NAME}\`.schema_migrations (filename) VALUES (?)`, [file]);
        console.log(`   📌 ${file} — marcada como já aplicada`);
      }
      await conn.end();
      console.log('\n🎉 Bootstrap do controle de migrations concluído! Rode `npm run migrate` de novo para aplicar migrations novas (se houver).\n');
      return;
    }
    // Nenhuma migration nova pendente de bootstrap — segue para o loop normal abaixo.
  }

  const [aplicadasRows] = await conn.query(
    `SELECT filename FROM \`${DB_NAME}\`.schema_migrations`,
  );
  const aplicadas = new Set(aplicadasRows.map((r) => r.filename));

  for (const file of files) {
    if (aplicadas.has(file)) {
      console.log(`⏭️  ${file} — já aplicada, pulando`);
      continue;
    }

    const filePath = join(__dirname, file);
    const sql = readFileSync(filePath, 'utf-8');

    console.log(`\n📄 Executando: ${file}`);
    try {
      await conn.query(sql);
      console.log(`   ✅ ${file} — OK`);
    } catch (err) {
      const jaExiste =
        err.code === 'ER_TABLE_EXISTS_ERROR' ||
        err.code === 'ER_DUP_KEYNAME' ||
        // Coluna já existe (ADD COLUMN em schema que já tem a coluna)
        err.code === 'ER_DUP_FIELDNAME' ||
        // Chave/FK não existe ao tentar dropar (DROP FK / DROP INDEX já removidos)
        err.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
        // Índice já existe (ADD INDEX / ADD UNIQUE INDEX)
        err.code === 'ER_DUP_INDEX' ||
        // errno 121 = FK constraint name duplicada (InnoDB)
        (err.code === 'ER_CANT_CREATE_TABLE' && err.errno === 1005 &&
          (err.sqlMessage?.includes('Duplicate') || err.sqlMessage?.includes('121'))) ||
        // errno 1826 = nome de FK duplicado (MySQL 8)
        err.errno === 1826;

      if (jaExiste) {
        console.log(`   ⚠️  ${file} — Já aplicado (objeto já existe), pulando...`);
      } else {
        console.error(`   ❌ ${file} — ERRO:`, err.message);
        throw err;
      }
    }

    // Registra como aplicada mesmo quando o objeto já existia (jaExiste):
    // a partir daqui este arquivo nunca mais roda de novo neste banco.
    await conn.query(`INSERT INTO \`${DB_NAME}\`.schema_migrations (filename) VALUES (?)`, [file]);
  }

  await conn.end();
  console.log('\n🎉 Migrations concluídas!\n');
}

runMigrations().catch((err) => {
  console.error('Falha nas migrations:', err);
  process.exit(1);
});
