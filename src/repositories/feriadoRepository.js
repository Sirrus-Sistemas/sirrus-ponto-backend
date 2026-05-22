import { query } from '../config/database.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export const FeriadoRepository = {
  /** Feriados da empresa entre o primeiro e o último dia do mês (inclusive). */
  async listByEmpresaMonth(empresaId, year, month) {
    const start = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;

    return query(
      `SELECT DATE_FORMAT(data, '%Y-%m-%d') AS dia, descricao, tipo
         FROM feriados
        WHERE empresa_id = ?
          AND data >= ?
          AND data <= ?
        ORDER BY data`,
      [empresaId, start, end],
    );
  },
};
