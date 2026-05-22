import { query } from '../config/database.js';

// Brazil is fixed UTC-3 since DST was abolished in 2019.
// Set APP_TZ_OFFSET env var to override if the company is in a different zone.
const TZ_OFFSET_DEFAULT = process.env.APP_TZ_OFFSET || '-03:00';

export const MarcacaoRepository = {
  /**
   * Registra uma batida (horário do servidor em data_hora).
   */
  async insert({ funcionarioId, tipo, deviceInfo, ipAddress }) {
    const tipoNorm = tipo && ['manual', 'geo', 'rep', 'online'].includes(tipo) ? tipo : 'online';
    const result = await query(
      `INSERT INTO marcacoes (funcionario_id, data_hora, tipo, device_info, ip_address)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, ?)`,
      [funcionarioId, tipoNorm, deviceInfo ?? null, ipAddress ?? null],
    );

    const insertId = result.insertId;
    const rows = await query(
      `SELECT id, data_hora, tipo FROM marcacoes WHERE id = ? LIMIT 1`,
      [insertId],
    );
    return rows[0] || null;
  },

  /**
   * Marcações do funcionário no mês (calendário pelo DATE(data_hora) no servidor).
   */
  async findById(id) {
    const rows = await query(
      `SELECT id, funcionario_id, data_hora, tipo, motivo_edicao, original
         FROM marcacoes WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async insertManual({ funcionarioId, dataHora, motivo, editadoPor }) {
    const result = await query(
      `INSERT INTO marcacoes
         (funcionario_id, data_hora, tipo, motivo_edicao, original, editado_por)
       VALUES (?, ?, 'manual', ?, 0, ?)`,
      [funcionarioId, dataHora, motivo || 'ESQUECIMENTO', editadoPor ?? null],
    );
    const rows = await query(
      `SELECT id, data_hora, tipo, motivo_edicao FROM marcacoes WHERE id = ? LIMIT 1`,
      [result.insertId],
    );
    return rows[0] || null;
  },

  async update(id, { dataHora, motivo, editadoPor }) {
    await query(
      `UPDATE marcacoes
          SET data_hora = ?, motivo_edicao = ?, editado_por = ?, original = 0
        WHERE id = ?`,
      [dataHora, motivo ?? null, editadoPor ?? null, id],
    );
  },

  async deleteById(id) {
    await query('DELETE FROM marcacoes WHERE id = ?', [id]);
  },

  async findByFuncionarioMonth(funcionarioId, year, month, tzOffset = TZ_OFFSET_DEFAULT) {
    // DATE_SUB 5h shifts the window so 00:00–04:59 local belongs to the previous shift day.
    return query(
      `SELECT id,
              data_hora,
              DATE_FORMAT(CONVERT_TZ(data_hora, '+00:00', ?), '%Y-%m-%dT%H:%i:%s') AS data_hora_local,
              tipo,
              motivo_edicao,
              original,
              DATE_FORMAT(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?), '%Y-%m-%d') AS dia
         FROM marcacoes
        WHERE funcionario_id = ?
          AND YEAR(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?))  = ?
          AND MONTH(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)) = ?
        ORDER BY data_hora ASC`,
      [tzOffset, tzOffset, funcionarioId, tzOffset, year, tzOffset, month],
    );
  },
};
