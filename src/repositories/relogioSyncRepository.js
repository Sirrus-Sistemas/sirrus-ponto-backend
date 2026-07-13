import { query } from '../config/database.js';

export const RelogioSyncRepository = {
  async enqueue(relogioId, funcionarioId, operacao) {
    await query(
      `INSERT INTO relogio_sync_fila (relogio_id, funcionario_id, operacao)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         operacao      = VALUES(operacao),
         status        = 'pendente',
         tentativas    = 0,
         erro_msg      = NULL,
         processado_em = NULL`,
      [relogioId, funcionarioId, operacao],
    );
  },

  async enqueueForAllRelogios(empresaId, funcionarioId, operacao) {
    const relogios = await query(
      'SELECT id FROM relogios_ponto WHERE empresa_id = ? AND ativo = 1 AND usa_afd = 0',
      [empresaId],
    );
    for (const r of relogios) {
      await this.enqueue(r.id, funcionarioId, operacao);
    }
    return relogios.length;
  },

  // Para o sistema de coleta local
  async findPendingByRelogio(relogioId, limit = 200) {
    return query(
      `SELECT f.id AS fila_id, f.funcionario_id, f.operacao, f.tentativas,
              func.nome, func.cpf, func.pis, func.ativo
       FROM relogio_sync_fila f
       JOIN funcionarios func ON func.id = f.funcionario_id
       WHERE f.relogio_id = ? AND f.status = 'pendente'
       ORDER BY f.criado_em
       LIMIT ?`,
      [relogioId, limit],
    );
  },

  async ack(filaId, status, erroMsg = null) {
    await query(
      `UPDATE relogio_sync_fila
       SET status        = ?,
           erro_msg      = ?,
           processado_em = NOW(),
           tentativas    = tentativas + 1
       WHERE id = ?`,
      [status, erroMsg, filaId],
    );
  },

  // Para o frontend
  async findByRelogio(relogioId, { status, search } = {}) {
    const conditions = ['f.relogio_id = ?'];
    const params = [relogioId];
    if (status) { conditions.push('f.status = ?'); params.push(status); }
    if (search) { conditions.push('func.nome LIKE ?'); params.push(`%${search}%`); }

    return query(
      `SELECT f.id, f.funcionario_id, f.operacao, f.status, f.tentativas,
              f.erro_msg, f.criado_em, f.processado_em, f.atualizado_em,
              func.nome, func.cpf, func.pis, func.cargo,
              l.nome AS lotacao_nome, d.nome AS departamento_nome
       FROM relogio_sync_fila f
       JOIN funcionarios func ON func.id = f.funcionario_id
       LEFT JOIN lotacoes     l ON l.id = func.lotacao_id
       LEFT JOIN departamentos d ON d.id = func.departamento_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE f.status WHEN 'pendente' THEN 0 WHEN 'erro' THEN 1 ELSE 2 END,
         f.atualizado_em DESC
       LIMIT 500`,
      params,
    );
  },

  async countPendingByEmpresa(empresaId) {
    return query(
      `SELECT f.relogio_id,
              SUM(f.status = 'pendente') AS total_pendente,
              SUM(f.status = 'erro')     AS total_erro
       FROM relogio_sync_fila f
       JOIN relogios_ponto r ON r.id = f.relogio_id
       WHERE r.empresa_id = ?
       GROUP BY f.relogio_id`,
      [empresaId],
    );
  },

  async retryErrors(relogioId) {
    const result = await query(
      `UPDATE relogio_sync_fila
       SET status = 'pendente', erro_msg = NULL, processado_em = NULL
       WHERE relogio_id = ? AND status = 'erro'`,
      [relogioId],
    );
    return result.affectedRows;
  },

  async remove(filaId, relogioId) {
    const result = await query(
      'DELETE FROM relogio_sync_fila WHERE id = ? AND relogio_id = ?',
      [filaId, relogioId],
    );
    return result.affectedRows;
  },

  // ── Heartbeat / saúde ──────────────────────────────────────────────

  async upsertHeartbeat(empresaId, { versao, status, ultimo_sync, relogios }) {
    await query(
      `INSERT INTO relogio_sistema_saude (empresa_id, versao, status, ultimo_sync, relogios)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         versao      = VALUES(versao),
         status      = VALUES(status),
         ultimo_sync = VALUES(ultimo_sync),
         relogios    = VALUES(relogios),
         recebido_em = NOW()`,
      [empresaId, versao ?? null, status ?? null, ultimo_sync ?? null, JSON.stringify(relogios ?? [])],
    );
  },

  async getSaude(empresaId) {
    const rows = await query(
      'SELECT * FROM relogio_sistema_saude WHERE empresa_id = ?',
      [empresaId],
    );
    const row = rows[0] ?? null;
    if (row?.relogios) {
      try { row.relogios = JSON.parse(row.relogios); } catch { row.relogios = []; }
    }
    return row;
  },
};
