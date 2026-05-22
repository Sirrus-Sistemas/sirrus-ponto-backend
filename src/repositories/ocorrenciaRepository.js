import { query } from '../config/database.js';

function pad2(n) { return String(n).padStart(2, '0'); }

export const OcorrenciaRepository = {
  /**
   * Retorna ocorrências do funcionário que interceptam o mês informado.
   */
  async findByFuncionarioMonth(funcionarioId, year, month) {
    const primeiro = `${year}-${pad2(month)}-01`;
    const ultimo   = `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
    return query(
      `SELECT o.id,
              DATE_FORMAT(o.data_inicio, '%Y-%m-%d') AS data_inicio,
              DATE_FORMAT(o.data_fim,    '%Y-%m-%d') AS data_fim,
              o.tipo, o.descricao,
              o.tipo_ocorrencia_id, o.turno, o.tipo_hora, o.quantidade_horas,
              t.descricao AS tipo_ocorrencia_descricao,
              t.tipo_lancamento
         FROM ocorrencias o
         LEFT JOIN tipos_ocorrencia t ON t.id = o.tipo_ocorrencia_id
        WHERE o.funcionario_id = ?
          AND o.data_inicio <= ? AND o.data_fim >= ?
        ORDER BY o.data_inicio`,
      [funcionarioId, ultimo, primeiro]
    );
  },
};
