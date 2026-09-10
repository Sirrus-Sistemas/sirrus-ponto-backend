import { query } from '../config/database.js';
import { criarModeloXlsx, lerLinhasXlsx, textoDaCelula, horaDaCelula, inteiroDaCelula } from '../utils/xlsxImport.js';

const COLUNAS = [
  { titulo: 'Nome*', largura: 30, textoLivre: true },
  { titulo: 'Entrada* (HH:MM)', largura: 16, textoLivre: true },
  { titulo: 'Saída Intervalo* (HH:MM)', largura: 18, textoLivre: true },
  { titulo: 'Retorno Intervalo* (HH:MM)', largura: 18, textoLivre: true },
  { titulo: 'Saída* (HH:MM)', largura: 16, textoLivre: true },
  { titulo: 'Tolerância Atraso (min)', largura: 18 },
  { titulo: 'Tolerância Extra (min)', largura: 18 },
  { titulo: 'Intervalo Mínimo (min)', largura: 18 },
  { titulo: 'Tipo (fixo/flexivel/escala)', largura: 20, textoLivre: true },
  { titulo: 'Batidas Esperadas por Dia', largura: 18 },
];

const HORA_REGEX = /^\d{2}:\d{2}$/;
const TIPOS_VALIDOS = ['fixo', 'flexivel', 'escala'];

function normalizarBatidasEsperadas(val) {
  if (val === undefined) return 8;
  if (!Number.isFinite(val) || val < 2 || val > 24 || val % 2 !== 0) return 8;
  return val;
}

/**
 * Modelo de import de tabela de horários: só o horário base
 * (entrada/intervalo/saída). Horário diferente por dia da semana
 * (turno_horarios) fica de fora — ajuste manual depois em Tabela de
 * Horários para quem precisar de dias diferentes.
 */
export async function gerarModeloTurnos() {
  return criarModeloXlsx({
    titulo: 'Tabela de Horários',
    instrucao:
      'Preencha uma tabela de horários por linha, a partir da linha 3. Não altere a linha 2 (cabeçalho). ' +
      'Horários no formato HH:MM (ex.: 08:00). As colunas opcionais, se deixadas em branco, usam o padrão ' +
      'do sistema. Horário diferente por dia da semana fica de fora do import — ajuste depois em Tabela de Horários.',
    colunas: COLUNAS,
  });
}

export async function importarTurnos(buffer, empresaId) {
  const linhas = await lerLinhasXlsx(buffer);
  if (linhas.length === 0) {
    return { erros: [{ linha: 3, campo: 'Nome', mensagem: 'A planilha não tem nenhuma linha preenchida.' }] };
  }

  const erros = [];
  const validas = [];

  for (const { numeroLinha, celulas } of linhas) {
    const nome = textoDaCelula(celulas[0]);
    const entrada = horaDaCelula(celulas[1]);
    const saidaIntervalo = horaDaCelula(celulas[2]);
    const retornoIntervalo = horaDaCelula(celulas[3]);
    const saida = horaDaCelula(celulas[4]);
    const toleranciaAtraso = inteiroDaCelula(celulas[5]);
    const toleranciaExtra = inteiroDaCelula(celulas[6]);
    const intervaloMinimo = inteiroDaCelula(celulas[7]);
    const tipo = textoDaCelula(celulas[8]).toLowerCase();
    const batidas = inteiroDaCelula(celulas[9]);

    let temErro = false;
    const erro = (campo, mensagem) => { erros.push({ linha: numeroLinha, campo, mensagem }); temErro = true; };

    if (nome.length < 2) erro('Nome', 'Informe um nome com pelo menos 2 caracteres.');
    if (!HORA_REGEX.test(entrada)) erro('Entrada', 'Informe um horário no formato HH:MM.');
    if (!HORA_REGEX.test(saidaIntervalo)) erro('Saída Intervalo', 'Informe um horário no formato HH:MM.');
    if (!HORA_REGEX.test(retornoIntervalo)) erro('Retorno Intervalo', 'Informe um horário no formato HH:MM.');
    if (!HORA_REGEX.test(saida)) erro('Saída', 'Informe um horário no formato HH:MM.');
    if (Number.isNaN(toleranciaAtraso)) erro('Tolerância Atraso', 'Deve ser um número inteiro.');
    if (Number.isNaN(toleranciaExtra)) erro('Tolerância Extra', 'Deve ser um número inteiro.');
    if (Number.isNaN(intervaloMinimo)) erro('Intervalo Mínimo', 'Deve ser um número inteiro.');
    if (tipo !== '' && !TIPOS_VALIDOS.includes(tipo)) erro('Tipo', 'Deve ser fixo, flexivel ou escala.');
    if (Number.isNaN(batidas)) erro('Batidas Esperadas por Dia', 'Deve ser um número inteiro.');

    if (temErro) continue;

    validas.push({
      nome,
      entrada,
      saida_intervalo: saidaIntervalo,
      retorno_intervalo: retornoIntervalo,
      saida,
      tolerancia_atraso_min: toleranciaAtraso ?? 10,
      tolerancia_extra_min: toleranciaExtra ?? 10,
      intervalo_minimo_min: intervaloMinimo ?? 60,
      tipo: tipo || 'fixo',
      batidas_esperadas_dia: normalizarBatidasEsperadas(batidas),
    });
  }

  if (erros.length > 0) return { erros };

  for (const t of validas) {
    await query(
      `INSERT INTO turnos
       (empresa_id, nome, entrada, saida_intervalo, retorno_intervalo, saida,
        tolerancia_atraso_min, tolerancia_extra_min, intervalo_minimo_min, tipo, batidas_esperadas_dia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, t.nome, t.entrada, t.saida_intervalo, t.retorno_intervalo, t.saida,
        t.tolerancia_atraso_min, t.tolerancia_extra_min, t.intervalo_minimo_min, t.tipo, t.batidas_esperadas_dia,
      ],
    );
  }

  return { importados: validas.length };
}
