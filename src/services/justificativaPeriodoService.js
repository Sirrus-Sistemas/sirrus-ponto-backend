import { MarcacaoRepository } from '../repositories/marcacaoRepository.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import { buscarPorPeriodo } from './escalaService.js';
import { fusoHorarioToTzOffset, parseTzOffsetMs } from './espelhoPontoService.js';
import { query } from '../config/database.js';
import { minutosDaJornada, previstosSemBatida } from '../utils/jornada.js';

const SLOT_FIELDS = ['entrada1', 'saida1', 'entrada2', 'saida2', 'entrada3', 'saida3', 'entrada4', 'saida4'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function eachDate(dataInicio, dataFim) {
  const datas = [];
  const cur = new Date(dataInicio + 'T12:00:00Z');
  const fim = new Date(dataFim + 'T12:00:00Z');
  while (cur <= fim) {
    datas.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return datas;
}

function diaSemana(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Dias inteiros entre duas datas "YYYY-MM-DD" (b − a). */
function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Converte horário local "HH:MM" para data_hora UTC ("YYYY-MM-DD HH:MM:SS").
 * A batida fica no dia de referência; `diasAMais` = 1 quando a jornada já
 * passou da meia-noite (ver minutosDaJornada). Antes, toda hora < 06:00 ia
 * para o dia ANTERIOR — a saída da madrugada ficava antes da própria entrada.
 * Mesma regra do frontend (batidaDataHora.ts).
 */
function horaLocalParaUtc(horaStr, dataRef, tzOffsetMs, diasAMais = 0) {
  const [hh, mm] = horaStr.slice(0, 5).split(':').map(Number);
  const [y, m, d] = dataRef.split('-').map(Number);
  const localNaiveMs = Date.UTC(y, m - 1, d + diasAMais, hh, mm, 0);
  const utcMs = localNaiveMs - tzOffsetMs;
  return new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19);
}

/** Mesma regra de espelhoPontoService.js: escala > turno_horarios > fallback CLT (domingo=folga). */
function diaPrevistoDeTrabalho(usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow) {
  if (usaEscala && escalaEntry) return escalaEntry.tipo !== 'folga';
  if (hasTurnoHorarios) return turnoHorariosMap.get(dow)?.trabalha === 1;
  return dow !== 0;
}

/** Resolve os horários previstos (HH:MM) de um dia: escala > turno_horarios > turno fixo do funcionário. */
function horariosPrevistosDoDia({ usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow, funcionario }) {
  if (usaEscala && escalaEntry && escalaEntry.tipo === 'trabalho') {
    return SLOT_FIELDS.map((c) => escalaEntry[c]).filter(Boolean).map((h) => h.slice(0, 5));
  }
  if (hasTurnoHorarios) {
    const th = turnoHorariosMap.get(dow);
    if (th && th.trabalha) {
      return [th.entrada, th.saida_intervalo, th.retorno_intervalo, th.saida].filter(Boolean).map((h) => h.slice(0, 5));
    }
    return [];
  }
  return [funcionario.turno_entrada, funcionario.turno_saida_intervalo, funcionario.turno_retorno_intervalo, funcionario.turno_saida]
    .filter(Boolean).map((h) => h.slice(0, 5));
}

export const JustificativaPeriodoService = {
  async executar({ funcionario, dataInicio, dataFim, modo, horariosManuais, justificativa, editadoPor }) {
    const datas = eachDate(dataInicio, dataFim);

    const empresa = funcionario.empresa_id ? await EmpresaRepository.findById(funcionario.empresa_id) : null;
    const tzOffset = fusoHorarioToTzOffset(funcionario.fuso_horario ?? empresa?.municipio_fuso_horario);
    const tzOffsetMs = parseTzOffsetMs(tzOffset);

    const usaEscala = Number(funcionario.usa_escala) === 1;

    const [bloqueadosRows, existentesRows, escalaRows, turnoHorariosRows] = await Promise.all([
      query(
        `SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data
           FROM marcacoes_dia_bloqueado
          WHERE funcionario_id = ? AND data BETWEEN ? AND ?`,
        [funcionario.id, dataInicio, dataFim],
      ),
      MarcacaoRepository.findByFuncionarioPeriodo(funcionario.id, dataInicio, dataFim, tzOffset, funcionario.turno_entrada),
      usaEscala ? buscarPorPeriodo(funcionario.id, dataInicio, dataFim) : Promise.resolve([]),
      funcionario.turno_id
        ? query(
            `SELECT dia_semana, trabalha, entrada, saida_intervalo, retorno_intervalo, saida
               FROM turno_horarios WHERE turno_id = ?`,
            [funcionario.turno_id],
          )
        : Promise.resolve([]),
    ]);

    const bloqueadoSet = new Set(bloqueadosRows.map((r) => r.data));

    // Por dia: horários "HH:MM" (modo manual, igualdade exata) e minutos desde
    // a meia-noite do dia de referência (modo automático, casamento por
    // proximidade — batida da madrugada seguinte conta +24h).
    const existentesPorDia = new Map();
    for (const row of existentesRows) {
      const dia = String(row.dia).slice(0, 10);
      const local = String(row.data_hora_local);
      if (!existentesPorDia.has(dia)) existentesPorDia.set(dia, { horas: new Set(), minutos: [] });
      const e = existentesPorDia.get(dia);
      e.horas.add(local.slice(11, 16));
      e.minutos.push(diasEntre(dia, local.slice(0, 10)) * 1440 + Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)));
    }

    const escalaMap = new Map();
    for (const e of escalaRows) escalaMap.set(e.data, e);

    const turnoHorariosMap = new Map();
    for (const t of turnoHorariosRows) turnoHorariosMap.set(Number(t.dia_semana), t);
    const hasTurnoHorarios = turnoHorariosMap.size > 0;

    let diasLancados = 0;
    let diasJaCompletos = 0;
    let diasIgnoradosBloqueado = 0;
    let diasIgnoradosSemExpediente = 0;
    const tuplas = [];

    for (const data of datas) {
      if (bloqueadoSet.has(data)) {
        diasIgnoradosBloqueado += 1;
        continue;
      }

      const dow = diaSemana(data);
      const escalaEntry = usaEscala ? escalaMap.get(data) : null;

      // Pula dias sem expediente previsto (folga na escala / trabalha=0 no turno) em
      // ambos os modos — manual e automático — respeitando a tabela de horários do funcionário.
      const previsto = diaPrevistoDeTrabalho(usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow);
      if (!previsto) {
        diasIgnoradosSemExpediente += 1;
        continue;
      }

      let horariosAlvo = null;
      if (modo === 'automatico') {
        horariosAlvo = horariosPrevistosDoDia({ usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow, funcionario });
        if (horariosAlvo.length === 0) {
          diasIgnoradosSemExpediente += 1;
          continue;
        }
      }

      const existentes = existentesPorDia.get(data) ?? { horas: new Set(), minutos: [] };

      // Manual: cada horário mantém sua posição fixa (slot_override = índice E1..S4).
      // Automático: cada batida real é casada com o horário previsto mais próximo
      // (mantendo a ordem) e só os previstos que sobram são lançados — o funcionário
      // quase nunca bate no minuto exato, e a falta pode ser no meio do dia.
      // Antes pulava os N primeiros previstos (N = nº de batidas): faltando a saída
      // do almoço (08:00, 14:00, 18:00), lançava um segundo 18:00 em vez do 12:00.
      let alvosFinal;
      if (modo === 'manual') {
        const preenchidos = SLOT_FIELDS
          .map((campo, idx) => ({ hora: horariosManuais?.[campo]?.slice(0, 5), slotOverride: idx }))
          .filter((a) => a.hora);
        const minutos = minutosDaJornada(preenchidos.map((a) => a.hora));
        alvosFinal = preenchidos
          .map((a, i) => ({ ...a, diasAMais: Math.floor(minutos[i] / 1440) }))
          .filter((a) => !existentes.horas.has(a.hora));
      } else {
        const minutosPrevistos = minutosDaJornada(horariosAlvo);
        const minutosReais = [...existentes.minutos].sort((a, b) => a - b);
        alvosFinal = previstosSemBatida(minutosPrevistos, minutosReais).map((i) => ({
          hora: horariosAlvo[i],
          slotOverride: null,
          diasAMais: Math.floor(minutosPrevistos[i] / 1440),
        }));
      }

      if (alvosFinal.length === 0) {
        diasJaCompletos += 1;
        continue;
      }

      diasLancados += 1;
      for (const alvo of alvosFinal) {
        const dataHoraUtc = horaLocalParaUtc(alvo.hora, data, tzOffsetMs, alvo.diasAMais);
        tuplas.push([
          funcionario.id,
          dataHoraUtc,
          'manual',
          justificativa,
          0,
          editadoPor,
          data,
          alvo.slotOverride,
        ]);
      }
    }

    let totalBatidas = 0;
    const LOTE = 500;
    for (let i = 0; i < tuplas.length; i += LOTE) {
      const lote = tuplas.slice(i, i + LOTE);
      const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const result = await query(
        `INSERT IGNORE INTO marcacoes
           (funcionario_id, data_hora, tipo, motivo_edicao, original, editado_por, dia_referencia, slot_override)
         VALUES ${placeholders}`,
        lote.flat(),
      );
      totalBatidas += result.affectedRows || 0;
    }

    return {
      dias_lancados: diasLancados,
      dias_ja_completos: diasJaCompletos,
      dias_ignorados_bloqueado: diasIgnoradosBloqueado,
      dias_ignorados_sem_expediente: diasIgnoradosSemExpediente,
      total_batidas: totalBatidas,
    };
  },
};
