import mysql from 'mysql2/promise';

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'ponto_web',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
      waitForConnections: true,
      charset: 'utf8mb4',
      timezone: '+00:00',
      decimalNumbers: true,
    });
  }
  return pool;
}

/**
 * Executa uma query com parâmetros.
 * @param {string} sql - Query SQL com placeholders ?
 * @param {Array} params - Parâmetros para bind
 * @returns {Promise<Array>} Resultado da query
 */
export async function query(sql, params = []) {
  const db = getPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

/**
 * Executa múltiplas queries dentro de uma transação.
 * @param {Function} callback - Recebe (conn) e deve executar as queries
 * @returns {Promise<any>} Resultado do callback
 */
export async function transaction(callback) {
  const db = getPool();
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Testa a conexão com o banco.
 */
export async function testConnection() {
  const db = getPool();
  const conn = await db.getConnection();
  await conn.ping();
  conn.release();
}

/**
 * Fecha o pool de conexões (para shutdown graceful).
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
