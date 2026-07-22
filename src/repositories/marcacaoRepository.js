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
      `SELECT id, funcionario_id, data_hora, tipo, motivo_edicao, original, slot_override
         FROM marcacoes WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async insertManual({ funcionarioId, dataHora, motivo, editadoPor, slotOverride, diaReferencia }) {
    const result = await query(
      `INSERT INTO marcacoes
         (funcionario_id, data_hora, tipo, motivo_edicao, original, editado_por, slot_override, dia_referencia)
       VALUES (?, ?, 'manual', ?, 0, ?, ?, ?)`,
      [funcionarioId, dataHora, motivo || 'ESQUECIMENTO', editadoPor ?? null, slotOverride ?? null, diaReferencia ?? null],
    );
    const rows = await query(
      `SELECT id, data_hora, tipo, motivo_edicao, slot_override FROM marcacoes WHERE id = ? LIMIT 1`,
      [result.insertId],
    );
    return rows[0] || null;
  },

  async update(id, { dataHora, motivo, editadoPor, slotOverride, diaReferencia }) {
    const sets = ['motivo_edicao = ?', 'editado_por = ?', 'original = 0'];
    const params = [motivo ?? null, editadoPor ?? null];

    if (dataHora !== undefined) {
      sets.unshift('data_hora = ?');
      params.unshift(dataHora);
    }
    if (slotOverride !== undefined) {
      sets.push('slot_override = ?');
      params.push(slotOverride ?? null);
    }
    if (diaReferencia !== undefined) {
      sets.push('dia_referencia = ?');
      params.push(diaReferencia ?? null);
    }

    params.push(id);
    await query(`UPDATE marcacoes SET ${sets.join(', ')} WHERE id = ?`, params);
  },

  async deleteById(id) {
    await query('DELETE FROM marcacoes WHERE id = ?', [id]);
  },

  /**
   * Importa uma marcação já vinculada a um funcionário (sistema de coleta
   * local). A dedup de verdade vem da UNIQUE (funcionario_id, data_hora)
   * da migration 026 — reenviar a mesma marcação não gera duplicata, só
   * affectedRows = 0. dataHora chega no horário LOCAL do relógio e é
   * armazenado como está (sem conversão para UTC). O espelho usa
   * data_hora diretamente para tipo='rep', sem CONVERT_TZ.
   *
   * Devolve o id da marcação (nova ou já existente) para quem chama poder
   * vincular a linha correspondente em relogio_marcacoes_importadas.
   */
  async insertFromRelogio({ funcionarioId, relogioId, nsr, dataHora }) {
    const result = await query(
      `INSERT IGNORE INTO marcacoes (funcionario_id, relogio_id, nsr, data_hora, tipo, original)
       VALUES (?, ?, ?, ?, 'rep', 1)`,
      [funcionarioId, relogioId, nsr, dataHora],
    );
    if (result.affectedRows > 0) {
      return { inserida: true, marcacaoId: result.insertId };
    }

    const [row] = await query(
      `SELECT id FROM marcacoes WHERE funcionario_id = ? AND data_hora = ? LIMIT 1`,
      [funcionarioId, dataHora],
    );
    return { inserida: false, marcacaoId: row?.id ?? null };
  },

  async findByFuncionarioMonth(funcionarioId, year, month, tzOffset = TZ_OFFSET_DEFAULT) {
    // DATE_SUB 5h shifts the window so 00:00–04:59 local belongs to the previous shift day.
    // dia_referencia overrides this automatic grouping for overnight punches beyond 05:00.
    // Batidas REP são armazenadas no horário LOCAL do relógio (sem conversão UTC).
    // Para elas, data_hora_local = data_hora direto. Para os demais tipos (online,
    // geo, manual) o valor é UTC e precisa de CONVERT_TZ para o fuso da empresa.
    return query(
      `SELECT id,
              data_hora,
              dia_referencia,
              DATE_FORMAT(
                CASE WHEN tipo = 'rep' THEN data_hora
                     ELSE CONVERT_TZ(data_hora, '+00:00', ?)
                END,
                '%Y-%m-%dT%H:%i:%s'
              ) AS data_hora_local,
              tipo,
              motivo_edicao,
              original,
              slot_override,
              COALESCE(
                DATE_FORMAT(dia_referencia, '%Y-%m-%d'),
                DATE_FORMAT(
                  CASE WHEN tipo = 'rep' THEN DATE_SUB(data_hora, INTERVAL 5 HOUR)
                       ELSE CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)
                  END,
                  '%Y-%m-%d'
                )
              ) AS dia
         FROM marcacoes
        WHERE funcionario_id = ?
          AND (
            (YEAR(CASE WHEN tipo = 'rep' THEN DATE_SUB(data_hora, INTERVAL 5 HOUR)
                       ELSE CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)
                  END) = ?
             AND MONTH(CASE WHEN tipo = 'rep' THEN DATE_SUB(data_hora, INTERVAL 5 HOUR)
                            ELSE CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)
                       END) = ?)
            OR (dia_referencia IS NOT NULL AND YEAR(dia_referencia) = ? AND MONTH(dia_referencia) = ?)
          )
        ORDER BY data_hora ASC`,
      [tzOffset, tzOffset, funcionarioId, tzOffset, year, tzOffset, month, year, month],
    );
  },

  /**
   * Marcações do funcionário num intervalo de datas arbitrário (mesma lógica de
   * agrupamento por dia_referencia/corte de 5h de findByFuncionarioMonth, mas
   * parametrizada por data início/fim em vez de ano/mês).
   */
  async findByFuncionarioPeriodo(funcionarioId, dataInicio, dataFim, tzOffset = TZ_OFFSET_DEFAULT) {
    return query(
      `SELECT id,
              data_hora,
              dia_referencia,
              DATE_FORMAT(
                CASE WHEN tipo = 'rep' THEN data_hora
                     ELSE CONVERT_TZ(data_hora, '+00:00', ?)
                END,
                '%Y-%m-%dT%H:%i:%s'
              ) AS data_hora_local,
              tipo,
              COALESCE(
                DATE_FORMAT(dia_referencia, '%Y-%m-%d'),
                DATE_FORMAT(
                  CASE WHEN tipo = 'rep' THEN DATE_SUB(data_hora, INTERVAL 5 HOUR)
                       ELSE CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)
                  END,
                  '%Y-%m-%d'
                )
              ) AS dia
         FROM marcacoes
        WHERE funcionario_id = ?
          AND (
            (DATE(CASE WHEN tipo = 'rep' THEN DATE_SUB(data_hora, INTERVAL 5 HOUR)
                       ELSE CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', ?)
                  END) BETWEEN ? AND ?)
            OR (dia_referencia IS NOT NULL AND dia_referencia BETWEEN ? AND ?)
          )
        ORDER BY data_hora ASC`,
      [tzOffset, tzOffset, funcionarioId, tzOffset, dataInicio, dataFim, dataInicio, dataFim],
    );
  },
};
