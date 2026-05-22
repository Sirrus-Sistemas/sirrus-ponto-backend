import mysql from 'mysql2/promise';

let _pool = null;

function isConfigured() {
  return !!(process.env.LICENCA_DB_HOST && process.env.LICENCA_DB_USER && process.env.LICENCA_DB_NAME);
}

function getPool() {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: process.env.LICENCA_DB_HOST,
    port: Number(process.env.LICENCA_DB_PORT) || 3306,
    user: process.env.LICENCA_DB_USER,
    password: process.env.LICENCA_DB_PASSWORD || '',
    database: process.env.LICENCA_DB_NAME,
    connectionLimit: 3,
    waitForConnections: true,
    charset: 'utf8mb4',
    connectTimeout: 8000,
  });
  return _pool;
}

function stripCnpj(cnpj) {
  return cnpj ? String(cnpj).replace(/\D/g, '') : '';
}

/**
 * Valida a licença de uma empresa pelo CNPJ consultando o banco remoto de liberações.
 * Lança erro HTTP 403 se a licença estiver expirada ou não encontrada.
 * Se as variáveis LICENCA_DB_* não estiverem configuradas, a validação é ignorada.
 *
 * @param {string} cnpj - CNPJ da empresa (formatado ou somente dígitos)
 * @param {import('pino').Logger} [log] - logger opcional para avisos
 */
export async function checkLicenca(cnpj, log) {
  if (!isConfigured()) return;

  const cnpjDigits = stripCnpj(cnpj);
  if (!cnpjDigits) {
    throw Object.assign(
      new Error('Empresa sem CNPJ cadastrado. Entre em contato com o suporte.'),
      { statusCode: 403 },
    );
  }

  const sistema = process.env.LICENCA_SISTEMA ?? '1';

  let rows;
  try {
    const pool = getPool();
    const [result] = await pool.execute(
      `SELECT validade
         FROM empresas
        WHERE REPLACE(REPLACE(REPLACE(cnpj, '.', ''), '/', ''), '-', '') = ?
          AND sistema_novo = ?
        LIMIT 1`,
      [cnpjDigits, sistema],
    );
    rows = result;
  } catch (err) {
    log?.warn({ err }, 'licencaService: falha ao consultar banco de licenças — acesso permitido por falha-aberta');
    return;
  }

  if (rows.length === 0) {
    throw Object.assign(
      new Error('Licença não encontrada para esta empresa. Entre em contato com o suporte.'),
      { statusCode: 403 },
    );
  }

  const validade = rows[0].validade;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const exp = validade instanceof Date ? validade : new Date(validade);
  exp.setHours(0, 0, 0, 0);

  if (exp < hoje) {
    throw Object.assign(
      new Error('Licença expirada. Entre em contato com o financeiro para regularizar.'),
      { statusCode: 403 },
    );
  }
}
