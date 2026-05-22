import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  // Conexão sem database para poder criar o banco
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3307,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  console.log('🔌 Conectado ao MariaDB');

  // Lê todos os arquivos .sql ordenados
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
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
        // errno 121 = FK constraint name duplicada (InnoDB)
        (err.code === 'ER_CANT_CREATE_TABLE' && err.errno === 1005 &&
          (err.sqlMessage?.includes('Duplicate') || err.sqlMessage?.includes('121')));

      if (jaExiste) {
        console.log(`   ⚠️  ${file} — Já aplicado (objeto já existe), pulando...`);
      } else {
        console.error(`   ❌ ${file} — ERRO:`, err.message);
        throw err;
      }
    }
  }

  await conn.end();
  console.log('\n🎉 Migrations concluídas!\n');
}

runMigrations().catch((err) => {
  console.error('Falha nas migrations:', err);
  process.exit(1);
});
