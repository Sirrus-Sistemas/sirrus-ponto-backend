import { query, transaction } from '../config/database.js';

// Cada ciclo: T = trabalho, F = folga
const CICLOS = {
  '1x5':          [1, 1, 1, 1, 1, 0],            // 6 dias
  '1x6':          [1, 1, 1, 1, 1, 1, 0],          // 7 dias
  '12x36':        [1, 0],                          // 2 dias
  '24x72':        [1, 0, 0, 0],                    // 4 dias
  '12x24x12x36':  [1, 0, 1, 0, 0],                // 5 dias
};

/**
 * Retorna array de objetos { data, tipo, ...horários } para o período.
 * Não persiste nada — usado para preview e salvar.
 */
export function gerarDias({
  dataInicio,       // Date JS ou 'YYYY-MM-DD'
  dataFim,          // Date JS ou 'YYYY-MM-DD'
  tipoCiclo,        // chave de CICLOS
  inicioCiclo,      // Date JS ou 'YYYY-MM-DD' — âncora do ciclo
  entrada1, saida1,
  entrada2, saida2,
  entrada3, saida3,
  entrada4, saida4,
  fimNoturno,
}) {
  const ciclo = CICLOS[tipoCiclo];
  if (!ciclo) throw new Error(`Tipo de ciclo inválido: ${tipoCiclo}`);

  const msPerDay = 86400000;
  const d0 = toDate(inicioCiclo).getTime();
  const fim = toDate(dataFim).getTime();
  const dias = [];

  for (let t = toDate(dataInicio).getTime(); t <= fim; t += msPerDay) {
    const diffDays = Math.round((t - d0) / msPerDay);
    const pos = ((diffDays % ciclo.length) + ciclo.length) % ciclo.length;
    const ehTrabalho = ciclo[pos] === 1;

    const dia = {
      data: toIsoDate(new Date(t)),
      tipo: ehTrabalho ? 'trabalho' : 'folga',
      entrada1: ehTrabalho ? (entrada1 || null) : null,
      saida1:   ehTrabalho ? (saida1   || null) : null,
      entrada2: ehTrabalho ? (entrada2 || null) : null,
      saida2:   ehTrabalho ? (saida2   || null) : null,
      entrada3: ehTrabalho ? (entrada3 || null) : null,
      saida3:   ehTrabalho ? (saida3   || null) : null,
      entrada4: ehTrabalho ? (entrada4 || null) : null,
      saida4:   ehTrabalho ? (saida4   || null) : null,
      fim_noturno: ehTrabalho ? (fimNoturno || null) : null,
    };
    dias.push(dia);
  }

  return dias;
}

/**
 * Persiste (upsert) os dias gerados na tabela escalas.
 * Substitui qualquer registro existente para o mesmo funcionário/data.
 * Ativa automaticamente usa_escala = 1 para o funcionário.
 */
export async function salvarEscala(funcionarioId, geradoPor, dias, tipoCiclo, inicioCiclo) {
  if (!dias.length) return 0;

  await transaction(async (conn) => {
    // Remove os dias do período para fazer upsert limpo
    const dataInicio = dias[0].data;
    const dataFim = dias[dias.length - 1].data;
    await conn.execute(
      'DELETE FROM escalas WHERE funcionario_id = ? AND data BETWEEN ? AND ?',
      [funcionarioId, dataInicio, dataFim]
    );

    // Ativa o modo escala para o funcionário caso ainda não esteja ativo
    await conn.execute(
      'UPDATE funcionarios SET usa_escala = 1 WHERE id = ? AND usa_escala = 0',
      [funcionarioId]
    );

    const sql = `
      INSERT INTO escalas
        (funcionario_id, data, tipo,
         entrada1, saida1, entrada2, saida2,
         entrada3, saida3, entrada4, saida4,
         fim_noturno, gerado_por, tipo_ciclo, inicio_ciclo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const d of dias) {
      await conn.execute(sql, [
        funcionarioId, d.data, d.tipo,
        d.entrada1, d.saida1, d.entrada2, d.saida2,
        d.entrada3, d.saida3, d.entrada4, d.saida4,
        d.fim_noturno, geradoPor, tipoCiclo || null, inicioCiclo || null,
      ]);
    }
  });

  return dias.length;
}

/**
 * Busca escalas de um funcionário em um período.
 */
export async function buscarPorPeriodo(funcionarioId, dataInicio, dataFim) {
  return query(
    `SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data, tipo,
            entrada1, saida1, entrada2, saida2,
            entrada3, saida3, entrada4, saida4,
            fim_noturno, tipo_ciclo,
            DATE_FORMAT(inicio_ciclo, '%Y-%m-%d') AS inicio_ciclo
     FROM escalas
     WHERE funcionario_id = ? AND data BETWEEN ? AND ?
     ORDER BY data`,
    [funcionarioId, dataInicio, dataFim]
  );
}

/**
 * Lista funcionários ativos para a tela de geração de escala.
 * Inclui todos os funcionários ativos — ao salvar a escala, usa_escala é ativado automaticamente.
 */
export async function listarFuncionariosComEscala(empresaId, filialId) {
  let sql = `
    SELECT f.id, f.nome, f.matricula, f.cargo,
           fi.nome AS filial_nome,
           d.nome  AS departamento_nome,
           t.nome  AS turno_nome,
           t.entrada AS turno_entrada, t.saida AS turno_saida,
           t.saida_intervalo, t.retorno_intervalo
    FROM funcionarios f
    LEFT JOIN filiais fi ON f.filial_id = fi.id
    LEFT JOIN departamentos d ON f.departamento_id = d.id
    LEFT JOIN turnos t ON f.turno_id = t.id
    WHERE f.empresa_id = ? AND f.ativo = 1
  `;
  const params = [empresaId];

  if (filialId) {
    sql += ' AND f.filial_id = ?';
    params.push(filialId);
  }

  sql += ' ORDER BY f.nome';
  return query(sql, params);
}

/**
 * Funcionários que JÁ têm escala gerada (pelo menos um dia em `escalas`) num
 * mês/ano específico — para a tela de localizar/editar escala existente, sem
 * precisar que o admin saiba de cor o funcionário e o período exatos.
 */
export async function listarEscalasGeradas(empresaId, { ano, mes, lotacaoId, filialId }) {
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const ultimo = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

  let sql = `
    SELECT f.id AS funcionario_id, f.nome, f.matricula, f.cargo,
           fi.nome AS filial_nome,
           f.lotacao_id, lo.nome AS lotacao_nome,
           DATE_FORMAT(MIN(e.data), '%Y-%m-%d') AS periodo_inicio,
           DATE_FORMAT(MAX(e.data), '%Y-%m-%d') AS periodo_fim,
           MAX(e.tipo_ciclo) AS tipo_ciclo,
           COUNT(*) AS total_dias
      FROM escalas e
      JOIN funcionarios f ON f.id = e.funcionario_id
      LEFT JOIN filiais fi ON fi.id = f.filial_id
      LEFT JOIN lotacoes lo ON lo.id = f.lotacao_id
     WHERE f.empresa_id = ? AND e.data BETWEEN ? AND ?
  `;
  const params = [empresaId, primeiro, ultimo];

  if (lotacaoId) { sql += ' AND f.lotacao_id = ?'; params.push(lotacaoId); }
  if (filialId) { sql += ' AND f.filial_id = ?'; params.push(filialId); }

  sql += ' GROUP BY f.id ORDER BY f.nome';
  return query(sql, params);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toDate(v) {
  if (v instanceof Date) return v;
  // 'YYYY-MM-DD' → parse sem TZ offset
  const [y, m, d] = String(v).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
