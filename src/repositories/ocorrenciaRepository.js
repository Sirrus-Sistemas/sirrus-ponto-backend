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
              o.tipo_ocorrencia_id, o.turno, o.tipo_hora, o.quantidade_horas, o.informativa,
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

  /**
   * Ocorrência existente que colide com o range/turno informado — usada pra
   * bloquear no lançamento. 'integral' cobre o dia inteiro e nunca pode
   * coexistir com outra ocorrência (de qualquer turno) no mesmo dia; duas
   * ocorrências de período específico só colidem se forem do MESMO período
   * (turnos diferentes, ex. 1º e 2º período, podem coexistir).
   */
  async existeConflito(funcionarioId, dataInicio, dataFim, turno, excludeId = null) {
    const params = [funcionarioId, dataFim, dataInicio, turno, turno];
    let sql = `
      SELECT id, turno FROM ocorrencias
       WHERE funcionario_id = ?
         AND data_inicio <= ? AND data_fim >= ?
         AND (turno = 'integral' OR ? = 'integral' OR turno = ?)
    `;
    if (excludeId != null) { sql += ' AND id != ?'; params.push(excludeId); }
    sql += ' LIMIT 1';
    const [row] = await query(sql, params);
    return row || null;
  },
};
