import { query, transaction } from '../config/database.js';

export const BancoHorasRepository = {
  /**
   * true se essa empresa não tem NENHUM lançamento em nenhum funcionário —
   * usado pra só oferecer o import do banco de horas do sistema antigo
   * enquanto ele ainda não foi feito (evita duplicar/misturar histórico).
   */
  async empresaSemNenhumLancamento(empresaId) {
    const [row] = await query(
      `SELECT COUNT(*) AS total
         FROM banco_horas bh
         JOIN funcionarios f ON f.id = bh.funcionario_id
        WHERE f.empresa_id = ?`,
      [empresaId],
    );
    return row.total === 0;
  },

  /**
   * Saldo atual acumulado, separado por tipo de hora (50% e 100% são
   * carteiras independentes — nunca se misturam).
   */
  async getSaldos(funcionarioId) {
    const rows = await query(
      `SELECT tipo_hora,
              SUM(CASE WHEN tipo = 'credito' THEN minutos ELSE -minutos END) AS saldo
         FROM banco_horas
        WHERE funcionario_id = ?
        GROUP BY tipo_hora`,
      [funcionarioId],
    );
    const saldos = { saldo_50pct_minutos: 0, saldo_100pct_minutos: 0 };
    for (const r of rows) {
      if (r.tipo_hora === '50pct') saldos.saldo_50pct_minutos = Number(r.saldo);
      else if (r.tipo_hora === '100pct') saldos.saldo_100pct_minutos = Number(r.saldo);
    }
    return saldos;
  },

  async contar(funcionarioId) {
    const [row] = await query('SELECT COUNT(*) AS total FROM banco_horas WHERE funcionario_id = ?', [funcionarioId]);
    return row.total;
  },

  /**
   * Extrato paginado (mais recentes primeiro).
   */
  async listar(funcionarioId, { limit = 50, offset = 0 } = {}) {
    const safeLimit = parseInt(limit, 10) || 50;
    const safeOffset = parseInt(offset, 10) || 0;
    return query(
      `SELECT bh.id, bh.data, bh.mes_referencia, bh.tipo, bh.tipo_hora, bh.minutos,
              bh.saldo_anterior, bh.saldo_posterior, bh.descricao, bh.origem, bh.created_at,
              f.nome AS lancado_por_nome
         FROM banco_horas bh
         LEFT JOIN funcionarios f ON f.id = bh.created_by
        WHERE bh.funcionario_id = ?
        ORDER BY bh.id DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [funcionarioId],
    );
  },

  /**
   * Grava um lançamento e calcula saldo_anterior/saldo_posterior no ato —
   * a ordem que importa é a de inserção (id crescente), não a `data`
   * escolhida no formulário (que pode ser retroativa).
   */
  async lancar({ funcionario_id, data, mes_referencia, tipo, tipo_hora, minutos, descricao, origem, created_by }) {
    const [row] = await query(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'credito' THEN minutos ELSE -minutos END), 0) AS saldo
         FROM banco_horas WHERE funcionario_id = ? AND tipo_hora = ?`,
      [funcionario_id, tipo_hora],
    );
    const saldoAnterior = Number(row.saldo);
    const delta = tipo === 'credito' ? minutos : -minutos;
    const saldoPosterior = saldoAnterior + delta;

    const result = await query(
      `INSERT INTO banco_horas
         (funcionario_id, data, mes_referencia, tipo, tipo_hora, minutos,
          saldo_anterior, saldo_posterior, descricao, origem, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        funcionario_id, data, mes_referencia, tipo, tipo_hora, minutos,
        saldoAnterior, saldoPosterior, descricao || null, origem, created_by ?? null,
      ],
    );
    return { id: result.insertId, saldo_anterior: saldoAnterior, saldo_posterior: saldoPosterior };
  },

  async buscarPorId(id) {
    const [row] = await query(
      `SELECT bh.*, f.empresa_id
         FROM banco_horas bh
         JOIN funcionarios f ON f.id = bh.funcionario_id
        WHERE bh.id = ?`,
      [id],
    );
    return row || null;
  },

  /**
   * Exclui um lançamento e recalcula saldo_anterior/saldo_posterior de TODOS
   * os lançamentos remanescentes daquela carteira (funcionario_id + tipo_hora),
   * na ordem de inserção — sem isso, o extrato dos lançamentos posteriores ao
   * excluído ficaria mostrando saldos que incluíam algo que não existe mais.
   * A checagem de origem ('manual' vs 'fechamento_mensal') é feita por quem chama.
   */
  async excluir(id) {
    return transaction(async (conn) => {
      const [rows] = await conn.execute('SELECT * FROM banco_horas WHERE id = ?', [id]);
      const linha = rows[0];
      if (!linha) return null;

      await conn.execute('DELETE FROM banco_horas WHERE id = ?', [id]);

      const [restantes] = await conn.execute(
        'SELECT id, tipo, minutos FROM banco_horas WHERE funcionario_id = ? AND tipo_hora = ? ORDER BY id ASC',
        [linha.funcionario_id, linha.tipo_hora],
      );
      let saldo = 0;
      for (const r of restantes) {
        const saldoAnterior = saldo;
        const delta = r.tipo === 'credito' ? r.minutos : -r.minutos;
        saldo += delta;
        await conn.execute(
          'UPDATE banco_horas SET saldo_anterior = ?, saldo_posterior = ? WHERE id = ?',
          [saldoAnterior, saldo, r.id],
        );
      }

      return linha;
    });
  },

  /**
   * tipo_hora(s) que já têm um fechamento mensal automático gravado pra este
   * funcionário/mês — usado pra recusar fechar o mesmo mês duas vezes.
   */
  async tiposJaFechados(funcionarioId, mesReferencia) {
    const rows = await query(
      `SELECT DISTINCT tipo_hora FROM banco_horas
        WHERE funcionario_id = ? AND mes_referencia = ? AND origem = 'fechamento_mensal'`,
      [funcionarioId, mesReferencia],
    );
    return rows.map((r) => r.tipo_hora);
  },
};
