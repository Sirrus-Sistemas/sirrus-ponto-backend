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
 * Retorna array de objetos { data, tipo, ...horários } para o período, a
 * partir do padrão semanal de um turno JÁ CADASTRADO (turno_horarios por
 * dia_semana) — alternativa ao ciclo fixo acima, pra quando o funcionário
 * usa uma tabela de horário pronta num trecho do mês (ex.: trabalhou 17h-23h
 * do dia 1 ao 15 e depois passou pro horário comercial do dia 16 em diante).
 * Não persiste nada — mesmo uso de gerarDias (preview e salvar).
 */
/**
 * Normaliza um horário (entrada/saida_intervalo/retorno_intervalo/saida) pro
 * par entrada1/saida1 + entrada2/saida2 da escala. Turno "corrido" (sem
 * intervalo, ex.: 17h-23h direto) grava o intervalo como 00:00:00 — colunas
 * de `turnos` são TIME NOT NULL, não aceitam NULL — ou, em `turno_horarios`,
 * como NULL mesmo; nos dois casos vira UM único par (entrada→saída), em vez
 * de forçar saida1 vazio e saida2 recebendo a saída de verdade (jornada de
 * 6h corridas virava "entrada1 sem saída1" + "saída2 sem entrada2").
 */
function normalizarHorario(h) {
  const semIntervalo = !h.saida_intervalo || !h.retorno_intervalo
    || h.saida_intervalo === '00:00:00' || h.saida_intervalo === h.retorno_intervalo;
  return semIntervalo
    ? { entrada1: h.entrada, saida1: h.saida, entrada2: null, saida2: null }
    : { entrada1: h.entrada, saida1: h.saida_intervalo, entrada2: h.retorno_intervalo, saida2: h.saida };
}

export async function gerarDiasDeTurno({ dataInicio, dataFim, turnoId }) {
  const horarios = await query(
    `SELECT dia_semana, trabalha, entrada, saida_intervalo, retorno_intervalo, saida
       FROM turno_horarios WHERE turno_id = ?`,
    [turnoId],
  );

  // Nem todo turno tem horário configurado por dia da semana (só quem já
  // passou pela grade "Horários por dia" em Turnos tem `turno_horarios`) —
  // pra esses, usa o horário único do próprio turno em todos os dias do
  // período, já que não existe outra fonte de "dia de folga" pra ele.
  let porDiaSemana;
  if (horarios.length > 0) {
    porDiaSemana = new Map(horarios.map((h) => [h.dia_semana, { trabalha: !!h.trabalha, ...normalizarHorario(h) }]));
  } else {
    const [turno] = await query(
      `SELECT entrada, saida_intervalo, retorno_intervalo, saida FROM turnos WHERE id = ?`,
      [turnoId],
    );
    if (!turno) throw new Error('Turno não encontrado.');
    const horarioUnico = { trabalha: true, ...normalizarHorario(turno) };
    porDiaSemana = new Map([0, 1, 2, 3, 4, 5, 6].map((d) => [d, horarioUnico]));
  }

  const msPerDay = 86400000;
  const fim = toDate(dataFim).getTime();
  const dias = [];

  for (let t = toDate(dataInicio).getTime(); t <= fim; t += msPerDay) {
    const data = new Date(t);
    const h = porDiaSemana.get(data.getDay());
    const ehTrabalho = !!h?.trabalha;

    dias.push({
      data: toIsoDate(data),
      tipo: ehTrabalho ? 'trabalho' : 'folga',
      entrada1: ehTrabalho ? h.entrada1 : null,
      saida1:   ehTrabalho ? h.saida1   : null,
      entrada2: ehTrabalho ? h.entrada2 : null,
      saida2:   ehTrabalho ? h.saida2   : null,
      entrada3: null, saida3: null, entrada4: null, saida4: null,
      fim_noturno: null,
    });
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
    WHERE f.empresa_id = ? AND f.ativo = 1 AND f.controla_ponto = 1
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
