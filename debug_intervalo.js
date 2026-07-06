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

async function verificarIntervalo(funcId, data) {
  const marcacoes = await query(
    `SELECT data_hora FROM marcacoes
     WHERE funcionario_id = ?
     AND DATE(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', '-03:00')) = ?
     ORDER BY data_hora ASC`,
    [funcId, data]
  );

  console.log(`\n${data}: ${marcacoes.length} batidas`);
  
  const times = marcacoes.map(m => new Date(m.data_hora).getTime()).sort((a, b) => a - b);
  
  let ultimoPar = false;
  for (let i = 0; i + 1 < times.length; i += 2) {
    const diff = times[i + 1] - times[i];
    console.log(`  Intervalo ${Math.floor(i/2)+1}: ${Math.round(diff/60000)} min`);
    ultimoPar = true;
  }
  
  if (times.length % 2 === 1) {
    console.log(`  ⚠️ Última batida é isolada (intervalo aberto!)`);
  } else if (!ultimoPar) {
    console.log(`  ✓ Todos os intervalos fechados`);
  }
}

await verificarIntervalo(121, '2026-06-17');
await verificarIntervalo(81, '2026-06-01');

process.exit(0);
