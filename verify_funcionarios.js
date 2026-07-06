import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function query(sql, params) {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(sql, params);
    return rows;
  } finally {
    connection.release();
  }
}

async function verificarFuncionario(nome, dia, mes = 6, ano = 2026) {
  try {
    // Busca funcionário por nome
    const funcs = await query(
      `SELECT id, nome FROM funcionarios WHERE nome LIKE ? AND ativo = 1 LIMIT 1`,
      [`%${nome}%`]
    );

    if (!funcs.length) {
      console.log(`❌ ${nome} - NÃO ENCONTRADO`);
      return;
    }

    const func = funcs[0];
    const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

    // Busca marcações daquele dia
    const marcacoes = await query(
      `SELECT id, data_hora, tipo, motivo_edicao
       FROM marcacoes
       WHERE funcionario_id = ?
       AND DATE(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', '-03:00')) = ?
       ORDER BY data_hora ASC`,
      [func.id, dataStr]
    );

    console.log(`\n📌 ${nome} (ID: ${func.id})`);
    console.log(`   Data: ${dataStr}`);
    console.log(`   Total de batidas: ${marcacoes.length}`);

    if (marcacoes.length === 0) {
      console.log(`   ⚠️  Nenhuma batida encontrada`);
      return;
    }

    // Agrupa por minuto
    const porMinuto = {};
    marcacoes.forEach(m => {
      const d = new Date(m.data_hora);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const key = `${hh}:${mm}`;
      if (!porMinuto[key]) porMinuto[key] = [];
      porMinuto[key].push({ hh, mm, data_hora: m.data_hora, tipo: m.tipo });
    });

    let temDuplicata = false;
    console.log(`   Batidas:`);
    Object.entries(porMinuto).forEach(([horario, batidas]) => {
      if (batidas.length > 1) {
        temDuplicata = true;
        console.log(`   ⚠️  ${horario} → ${batidas.length} batidas`);
        batidas.forEach((b, idx) => {
          const d = new Date(b.data_hora);
          const ss = String(d.getSeconds()).padStart(2, '0');
          console.log(`       [${idx + 1}] ${d.toISOString()} (${b.tipo})`);
        });
      } else {
        console.log(`   ✓ ${horario}`);
      }
    });

    if (temDuplicata) {
      console.log(`   🔴 PROBLEMA: Tem batidas duplicadas - deve estar "inconsistente"`);
    }

  } catch (err) {
    console.error(`Erro ao verificar ${nome}:`, err.message);
  }
}

async function main() {
  console.log('🔍 Verificando funcionários com inconsistência\n');

  await verificarFuncionario('Mariana Alves Silva', 17);
  await verificarFuncionario('Kalina da Silva Ferreira', 17);
  await verificarFuncionario('Kelly Schimith Santos', 17);
  await verificarFuncionario('Ana Luiza Frota Oliveira', 1);

  process.exit(0);
}

main();
