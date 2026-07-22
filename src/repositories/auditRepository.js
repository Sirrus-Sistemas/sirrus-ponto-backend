import { query } from '../config/database.js';

function buildWhere(empresaId, { dataInicio, dataFim, tabela, acao, usuarioId }) {
  const conditions = ['a.empresa_id = ?', 'a.created_at BETWEEN ? AND ?'];
  const params = [empresaId, `${dataInicio} 00:00:00`, `${dataFim} 23:59:59`];

  if (tabela)    { conditions.push('a.tabela = ?');     params.push(tabela); }
  if (acao)      { conditions.push('a.acao = ?');       params.push(acao); }
  if (usuarioId) { conditions.push('a.usuario_id = ?'); params.push(usuarioId); }

  return { where: conditions.join(' AND '), params };
}

export const AuditRepository = {
  async listar(empresaId, filtros) {
    const { where, params } = buildWhere(empresaId, filtros);
    const { limit = 50, offset = 0 } = filtros;
    return query(
      `SELECT a.id, a.usuario_id, a.acao, a.tabela, a.registro_id,
              a.dados_anteriores, a.dados_novos, a.ip_address, a.created_at,
              f.nome AS usuario_nome
         FROM audit_log a
         LEFT JOIN funcionarios f ON f.id = a.usuario_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  },

  async contar(empresaId, filtros) {
    const { where, params } = buildWhere(empresaId, filtros);
    const [row] = await query(
      `SELECT COUNT(*) AS total FROM audit_log a WHERE ${where}`,
      params,
    );
    return row.total;
  },
};
