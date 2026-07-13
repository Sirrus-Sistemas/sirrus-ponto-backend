import { query } from '../config/database.js';

export const RelogioRepository = {
  async findByEmpresa(empresaId) {
    return query(
      `SELECT r.*, f.nome AS filial_nome
       FROM relogios_ponto r
       LEFT JOIN filiais f ON f.id = r.filial_id
       WHERE r.empresa_id = ?
       ORDER BY r.descricao`,
      [empresaId],
    );
  },

  async findById(id, empresaId) {
    const rows = await query(
      `SELECT r.*, f.nome AS filial_nome
       FROM relogios_ponto r
       LEFT JOIN filiais f ON f.id = r.filial_id
       WHERE r.id = ? AND r.empresa_id = ?`,
      [id, empresaId],
    );
    return rows[0] ?? null;
  },

  async create(empresaId, data) {
    const result = await query(
      `INSERT INTO relogios_ponto
         (empresa_id, filial_id, numero_serie, descricao, modelo, ip, porta, usuario, senha, usa_afd, sincronizar_desde)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        data.filial_id ?? null,
        data.numero_serie,
        data.descricao,
        data.modelo,
        data.ip      || null,
        data.porta   ?? null,
        data.usuario || null,
        data.senha   || null,
        data.usa_afd ? 1 : 0,
        data.sincronizar_desde,
      ],
    );
    return result.insertId;
  },

  async update(id, empresaId, data) {
    const allowed = ['filial_id', 'numero_serie', 'descricao', 'modelo', 'ip', 'porta', 'usuario', 'senha', 'usa_afd', 'ativo', 'sincronizar_desde'];
    const boolFields = new Set(['usa_afd', 'ativo']);
    const nullableStr = new Set(['ip', 'usuario', 'senha', 'filial_id', 'porta']);
    const fields = [];
    const values = [];

    for (const key of allowed) {
      if (!(key in data)) continue;
      fields.push(`${key} = ?`);
      if (boolFields.has(key)) {
        values.push(data[key] ? 1 : 0);
      } else if (nullableStr.has(key)) {
        values.push(data[key] || null);
      } else {
        values.push(data[key]);
      }
    }

    if (!fields.length) return;
    values.push(id, empresaId);
    return query(
      `UPDATE relogios_ponto SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`,
      values,
    );
  },

  async remove(id, empresaId) {
    return query(
      'DELETE FROM relogios_ponto WHERE id = ? AND empresa_id = ?',
      [id, empresaId],
    );
  },

  /**
   * Para o sistema de coleta local: lista relógios ativos com IP/porta.
   * Inclui a senha do equipamento — sem ela o sistema de coleta local não
   * consegue autenticar no relógio (login.fcgi). O endpoint já exige
   * admin autenticado e escopo de empresa, mesma fronteira de confiança
   * de usuario/ip/porta, que já eram devolvidos aqui.
   */
  async findForSync(empresaId) {
    return query(
      `SELECT r.id, r.numero_serie, r.descricao, r.modelo,
              r.ip, r.porta, r.usuario, r.senha, r.usa_afd, r.filial_id,
              r.sincronizar_desde,
              f.nome AS filial_nome
       FROM relogios_ponto r
       LEFT JOIN filiais f ON f.id = r.filial_id
       WHERE r.empresa_id = ? AND r.ativo = 1
       ORDER BY r.descricao`,
      [empresaId],
    );
  },
};
