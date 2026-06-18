import { MarcacaoRepository } from '../repositories/marcacaoRepository.js';
import { FeriadoRepository } from '../repositories/feriadoRepository.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import { OcorrenciaRepository } from '../repositories/ocorrenciaRepository.js';
import { buscarPorPeriodo } from './escalaService.js';
import { toIsoDataHoraUtc } from '../utils/dataHoraIso.js';
import { query } from '../config/database.js';

const TIPO_LABEL = {
  manual: 'Manual',
  geo: 'GEO',
  rep: 'REP',
  online: 'WEB',
};

/**
 * Distribui marcações em 8 slots posicionais respeitando slot_override.
 * Retorna array esparso de tamanho 8 (null onde não há batida).
 * Mesma lógica do buildSlots do frontend — mantém consistência entre tela e relatório.
 *
 * @param {Array} items  Marcações já formatadas para saída (com campo slot_override).
 * @returns {Array}      Array de tamanho 8 com nulls nos slots vazios.
 */
function applySlotOverride(items) {
  const hasOverride = items.some(m => m.slot_override !== null && m.slot_override !== undefined);
  if (!hasOverride) return items; // sem override: retorna ordem cronológica original

  const slots = new Array(8).fill(null);
  const overridden = items
    .filter(m => m.slot_override !== null && m.slot_override !== undefined)
    .sort((a, b) => a.slot_override - b.slot_override);
  const normal = items
    .filter(m => m.slot_override === null || m.slot_override === undefined);
  // normal já vem em ordem cronológica (raw foi ordenado por data_hora ASC)

  for (const m of overridden) {
    const pos = m.slot_override;
    if (pos < 8 && slots[pos] === null) slots[pos] = m;
  }

  let ni = 0;
  for (let i = 0; i < 8 && ni < normal.length; i++) {
    if (slots[i] === null) slots[i] = normal[ni++];
  }

  return slots.filter(m => m !== null);
}

function fmtTime(val) {
  if (!val) return null;
  return String(val).slice(0, 5); // "HH:MM:SS" → "HH:MM"
}

function buildTurnoHorario(func) {
  const e = fmtTime(func.turno_entrada);
  const si = fmtTime(func.turno_saida_intervalo);
  const ri = fmtTime(func.turno_retorno_intervalo);
  const s = fmtTime(func.turno_saida);
  if (!e && !s) return null;
  if (si && ri) return `${e}-${si}/${ri}-${s}`;
  return `${e}-${s}`;
}


function pad2(n) {
  return String(n).padStart(2, '0');
}

function cargaHorariaParaMinutos(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'string') {
    const parts = val.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  return null;
}

function eachCalendarDay(year, month) {
  const last = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d += 1) {
    days.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  return days;
}

function minutosTrabalhadosPar(punches) {
  if (!punches.length) return { minutos: 0, incompleto: false };
  const times = punches.map((p) => new Date(p.data_hora).getTime()).sort((a, b) => a - b);
  let minutos = 0;
  for (let i = 0; i + 1 < times.length; i += 2) {
    minutos += Math.round((times[i + 1] - times[i]) / 60000);
  }
  return { minutos, incompleto: times.length % 2 === 1 };
}

function diaSemanaPt(dataStr) {
  const [y, m, d] = dataStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function calcMinutosEscala(e) {
  function diff(entrada, saida) {
    if (!entrada || !saida) return 0;
    const [eh, em] = String(entrada).slice(0, 5).split(':').map(Number);
    const [sh, sm] = String(saida).slice(0, 5).split(':').map(Number);
    let d = (sh * 60 + sm) - (eh * 60 + em);
    if (d < 0) d += 24 * 60; // turno que passa da meia-noite
    return d;
  }
  return (
    diff(e.entrada1, e.saida1) +
    diff(e.entrada2, e.saida2) +
    diff(e.entrada3, e.saida3) +
    diff(e.entrada4, e.saida4)
  );
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const DIAS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function normalizarBatidasEsperadas(val) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2 || n > 24 || n % 2 !== 0) return 8;
  return n;
}

function batidasEsperadasDoDia(th) {
  if (!th || !th.trabalha) return null;
  // Count non-null time slots: each filled slot is one expected punch
  let count = 0;
  if (th.entrada)           count++;
  if (th.saida_intervalo)   count++;
  if (th.retorno_intervalo) count++;
  if (th.saida)             count++;
  return count >= 2 ? count : 2;
}

// ── Adicional Noturno ─────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60000;
const NOTURNO_FIM_MIN = 5 * 60; // 05:00 — fixed by CLT

/**
 * Converte string de offset ("-03:00", "UTC-05:00", "+00:00") para milissegundos.
 * Padrão: -03:00 (Brazil SE).
 */
function parseTzOffsetMs(str) {
  const s = String(str || '-03:00').replace(/^UTC/, '');
  const m = s.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return -180 * 60000;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60000;
}

/**
 * Converte fuso_horario do município ("UTC-05:00") para offset SQL ("-05:00").
 * Padrão: "-03:00".
 */
export function fusoHorarioToTzOffset(fusoHorario) {
  const m = String(fusoHorario || '').match(/UTC([+-]\d{2}:\d{2})/);
  return m ? m[1] : (process.env.APP_TZ_OFFSET || '-03:00');
}

function parseHoraMin(val) {
  if (!val) return 22 * 60;
  const [h, mi] = String(val).slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (mi || 0);
}

function minutosNocturnosIntervalo(startUtcMs, endUtcMs, noturnoInicioMin, tzOffsetMs) {
  const startLocal = startUtcMs + tzOffsetMs;
  const endLocal   = endUtcMs   + tzOffsetMs;
  const inicioMs   = noturnoInicioMin * 60000;
  const fimMs      = NOTURNO_FIM_MIN  * 60000;
  let total = 0;
  const startDay = Math.floor(startLocal / DAY_MS) * DAY_MS;
  const endDay   = Math.floor((endLocal - 1) / DAY_MS) * DAY_MS;
  for (let day = startDay; day <= endDay; day += DAY_MS) {
    // Late-night segment: [day+22:00, day+24:00)
    const i1s = Math.max(startLocal, day + inicioMs);
    const i1e = Math.min(endLocal,   day + DAY_MS);
    if (i1e > i1s) total += i1e - i1s;
    // Early-morning segment: [day+00:00, day+05:00)
    const i2s = Math.max(startLocal, day);
    const i2e = Math.min(endLocal,   day + fimMs);
    if (i2e > i2s) total += i2e - i2s;
  }
  return Math.round(total / 60000);
}

function minutosNocturnosPar(punches, noturnoInicioMin, tzOffsetMs) {
  if (!punches.length) return 0;
  const times = punches.map((p) => new Date(p.data_hora).getTime()).sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < times.length; i += 2) {
    total += minutosNocturnosIntervalo(times[i], times[i + 1], noturnoInicioMin, tzOffsetMs);
  }
  return total;
}

/** Returns the UTC ms timestamp for midnight local at the END of shiftDateStr (= start of next local day). */
function endOfShiftDayMs(shiftDateStr, tzOffsetMs) {
  const [y, m, d] = shiftDateStr.split('-').map(Number);
  // UTC-safe: next day 00:00 UTC + abs(tz offset) = next day 00:00 local
  return Date.UTC(y, m - 1, d + 1) - tzOffsetMs;
}

/** Minutes worked strictly after local midnight of shiftDateStr. */
function minutosAposMeiaNoite(punches, shiftDateStr, tzOffsetMs) {
  const midnightMs = endOfShiftDayMs(shiftDateStr, tzOffsetMs);
  const times = punches.map((p) => new Date(p.data_hora).getTime()).sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < times.length; i += 2) {
    const end = times[i + 1];
    if (end > midnightMs) total += end - Math.max(times[i], midnightMs);
  }
  return Math.round(total / 60000);
}

function nextDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function diaPrevistoDeTrabalho(usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow) {
  if (usaEscala && escalaEntry) return escalaEntry.tipo !== 'folga';
  if (hasTurnoHorarios) return turnoHorariosMap.get(dow)?.trabalha === 1;
  return dow !== 0; // CLT fallback
}

function feriadoAfetaFuncionario(feriado, funcionario) {
  if (!feriado) return false;
  if (feriado.tipo === 'nacional' || feriado.tipo === 'empresa') return true;
  if (feriado.tipo === 'estadual') {
    if (!funcionario.municipio_id) return false; // sem cidade cadastrada, estado desconhecido
    return funcionario.municipio_estado === feriado.uf;
  }
  if (feriado.tipo === 'municipal') {
    if (!funcionario.municipio_id) return false; // sem cidade cadastrada, município desconhecido
    return String(funcionario.municipio_ibge) === String(feriado.municipio_ibge);
  }
  return false;
}

function resolverIgual(tipo, lotacao) {
  if (tipo === 'igual_domingo') return lotacao.domingo_tipo;
  if (tipo === 'igual_feriado') return lotacao.feriado_tipo;
  return tipo;
}

function aplicarTipo(tipo, minutos_trabalhados, minutos_previstos) {
  switch (tipo) {
    case 'nao_calcular': return 0;
    case '50pct':        return Math.floor(Math.max(0, minutos_trabalhados - (minutos_previstos || 0)) * 0.5);
    case '100pct_extra': return Math.max(0, minutos_trabalhados - (minutos_previstos || 0));
    case '100pct_total': return minutos_trabalhados;
    default:             return 0;
  }
}

function calcExtras100pct({ feriado, dow, lotacao, marcacoes, minutos_trabalhados, minutos_previstos, diaPrevisto }) {
  if (!lotacao || marcacoes.length === 0) return 0;
  if (feriado) return aplicarTipo(lotacao.feriado_tipo, minutos_trabalhados, minutos_previstos);
  if (dow === 0) {
    const tipo = diaPrevisto
      ? lotacao.domingo_tipo
      : resolverIgual(lotacao.domingo_nao_previsto_tipo, lotacao);
    return aplicarTipo(tipo, minutos_trabalhados, minutos_previstos);
  }
  if (!diaPrevisto) {
    return aplicarTipo(resolverIgual(lotacao.dia_nao_previsto_tipo, lotacao), minutos_trabalhados, minutos_previstos);
  }
  return 0;
}

export const EspelhoPontoService = {
  async buildEspelho(funcionarioId, empresaId, year, month) {
    const dataInicio = `${year}-${pad2(month)}-01`;
    const dataFim = `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;

    // Carrega funcionário e empresa em paralelo para resolver o fuso:
    // 1º município do funcionário, 2º município da empresa, 3º APP_TZ_OFFSET
    const [funcionario, empresa] = await Promise.all([
      FuncionarioRepository.findById(funcionarioId),
      EmpresaRepository.findById(empresaId),
    ]);
    const tzOffset = fusoHorarioToTzOffset(
      funcionario?.fuso_horario ?? empresa?.municipio_fuso_horario
    );
    const tzOffsetMs = parseTzOffsetMs(tzOffset);

    const [rows, feriadosRows, turnoRow, ocorrencias] = await Promise.all([
      MarcacaoRepository.findByFuncionarioMonth(funcionarioId, year, month, tzOffset),
      FeriadoRepository.listByEmpresaMonth(empresaId, year, month),
      FuncionarioRepository.findTurnoJornada(funcionarioId),
      OcorrenciaRepository.findByFuncionarioMonth(funcionarioId, year, month),
    ]);

    // Load per-day turno hours and lotação rules in parallel
    const turnoHorariosMap = new Map();
    const [thRows, lotRows] = await Promise.all([
      turnoRow?.turno_id
        ? query(
            `SELECT dia_semana, trabalha, carga_minutos,
                    entrada, saida_intervalo, retorno_intervalo, saida
               FROM turno_horarios WHERE turno_id = ?`,
            [turnoRow.turno_id],
          )
        : Promise.resolve([]),
      funcionario?.lotacao_id
        ? query('SELECT feriado_tipo, domingo_tipo, domingo_nao_previsto_tipo, dia_nao_previsto_tipo, hora_inicio_adicional_noturno, dividir_extras_50_100 FROM lotacoes WHERE id = ?', [funcionario.lotacao_id])
        : Promise.resolve([]),
    ]);
    for (const r of thRows) turnoHorariosMap.set(Number(r.dia_semana), r);
    const lotacao = lotRows[0] || null;
    const hasTurnoHorarios = turnoHorariosMap.size > 0;

    const usaEscala = Number(funcionario?.usa_escala) === 1;

    const escalaMap = new Map();
    if (usaEscala) {
      const escalaDias = await buscarPorPeriodo(funcionarioId, dataInicio, dataFim);
      for (const e of escalaDias) {
        escalaMap.set(String(e.data).slice(0, 10), e);
      }
    }

    // Expand ocorrência date ranges into per-day entries (first occurrence wins)
    const ocorrenciaMap = new Map();
    for (const oc of ocorrencias) {
      let t = new Date(String(oc.data_inicio).slice(0, 10) + 'T12:00:00');
      const end = new Date(String(oc.data_fim).slice(0, 10) + 'T12:00:00');
      while (t <= end) {
        const d = toIsoDate(t);
        if (!ocorrenciaMap.has(d)) ocorrenciaMap.set(d, oc);
        t = new Date(t.getTime() + 86400000);
      }
    }

    const today = toIsoDate(new Date());
    const minutosPrevistoDia = cargaHorariaParaMinutos(turnoRow?.carga);
    const turnoNome = turnoRow?.turno_nome || null;
    const toleranciaAtraso = Number(turnoRow?.tolerancia_atraso_min) || 0;
    const toleranciaExtra  = Number(turnoRow?.tolerancia_extra_min)  || 0;
    const batidasEsperadasDia =
      turnoRow?.turno_id != null ? normalizarBatidasEsperadas(turnoRow?.batidas_esperadas_dia) : null;

    const feriadosMap = new Map();
    for (const f of feriadosRows) {
      feriadosMap.set(String(f.dia).slice(0, 10), { descricao: f.descricao, tipo: f.tipo, uf: f.uf || null, municipio_ibge: f.municipio_ibge || null });
    }

    const byDay = new Map();
    for (const row of rows) {
      const dia = String(row.dia).slice(0, 10);
      if (!byDay.has(dia)) byDay.set(dia, []);
      byDay.get(dia).push(row);
    }

    let minutosMes = 0;
    let diasComMarcacao = 0;
    let diasIncompletos = 0;
    let saldoMes = 0;
    let diasPresentes = 0;
    let diasFalta = 0;
    let diasFolga = 0;
    let diasOcorrencia = 0;
    let totalExtras100pct = 0;
    let totalExtras50pct = 0;
    let totalMinutosNoturno = 0;
    const noturnoInicioMin = parseHoraMin(lotacao?.hora_inicio_adicional_noturno);

    const dias = eachCalendarDay(year, month).map((data) => {
      const raw = byDay.get(data) || [];
      const marcacoesRaw = raw.map((r) => ({
        id: r.id,
        data_hora: toIsoDataHoraUtc(r.data_hora),
        data_hora_local: toIsoDataHoraUtc(r.data_hora),
        tipo: r.tipo,
        tipo_label: TIPO_LABEL[r.tipo] || r.tipo,
        motivo_edicao: r.motivo_edicao || null,
        original: Number(r.original),
        slot_override: r.slot_override !== undefined ? r.slot_override : null,
      }));
      // Aplica slot_override: garante que relatório e tela usem a mesma ordem de exibição.
      // raw (order by data_hora) continua sendo usado para cálculos de minutos.
      const marcacoes = applySlotOverride(marcacoesRaw);

      const { minutos, incompleto: intervaloAberto } = minutosTrabalhadosPar(raw);
      const dow = diaSemanaPt(data);
      const feriadoRaw = feriadosMap.get(data) || null;
      const feriado = feriadoAfetaFuncionario(feriadoRaw, funcionario) ? feriadoRaw : null;
      const isFuturo = data > today;
      const ocorrencia = ocorrenciaMap.get(data) || null;

      const escalaEntry = usaEscala ? escalaMap.get(data) : null;
      const diaPrevisto = diaPrevistoDeTrabalho(usaEscala, escalaEntry, hasTurnoHorarios, turnoHorariosMap, dow);

      const modifiers = [];
      if (feriado) modifiers.push('feriado');

      let status;
      let ehDiaTrabalho = false;

      if (isFuturo) {
        status = 'futuro';
      } else if (ocorrencia) {
        status = 'ocorrencia';
        ehDiaTrabalho = true;
      } else if (feriado) {
        // Feriado: repouso remunerado pela CLT — ausência não é falta.
        // Se houver batidas, é 'presente' com 100% sobre tudo; sem batidas, é 'folga'.
        if (marcacoes.length > 0) {
          status = 'presente';
          ehDiaTrabalho = false; // saldo zerado abaixo; não gera débito
        } else {
          status = 'folga';
        }
      } else if (usaEscala) {
        if (!escalaEntry) {
          status = 'sem_escala';
          modifiers.push('escala_ausente');
        } else if (escalaEntry.tipo === 'folga') {
          status = 'folga';
        } else {
          ehDiaTrabalho = true;
          status = marcacoes.length > 0 ? 'presente' : 'falta';
        }
      } else if (hasTurnoHorarios) {
        const th = turnoHorariosMap.get(dow);
        if (!th || !th.trabalha) {
          status = 'folga';
        } else {
          ehDiaTrabalho = true;
          status = marcacoes.length > 0 ? 'presente' : 'falta';
        }
      } else {
        // CLT fallback: Dom(0) = folga; Seg–Sáb = dia de trabalho
        if (dow === 0) {
          status = 'folga';
        } else {
          ehDiaTrabalho = true;
          status = marcacoes.length > 0 ? 'presente' : 'falta';
          modifiers.push('sem_regime');
        }
      }

      // trabalho_em_folga: marcações em dia não previsto (exceto futuro e ocorrencia)
      if (!diaPrevisto && !isFuturo && status !== 'ocorrencia' && marcacoes.length > 0) {
        modifiers.push('trabalho_em_folga');
      }

      // incompleto: apenas dias de trabalho com marcações e batidas ímpares
      if (ehDiaTrabalho && marcacoes.length > 0 && marcacoes.length % 2 !== 0) {
        modifiers.push('incompleto');
      }

      if (status === 'presente') diasPresentes += 1;
      else if (status === 'falta') diasFalta += 1;
      else if (status === 'folga') diasFolga += 1;
      else if (status === 'ocorrencia') diasOcorrencia += 1;

      let minutos_previstos = null;
      let saldo_minutos = null;
      if (ehDiaTrabalho) {
        // For occurrence days, respect quantidade_horas when specified;
        // otherwise fall back to turno's carga for 'integral', or full day for other periods.
        if (status === 'ocorrencia' && ocorrencia?.quantidade_horas != null) {
          minutos_previstos = Math.round(Number(ocorrencia.quantidade_horas) * 60);
        } else if (usaEscala && escalaEntry && escalaEntry.tipo === 'trabalho') {
          // Use the scheduled time pairs; fall back to turno when escala has no times
          const mins = calcMinutosEscala(escalaEntry);
          minutos_previstos = mins > 0
            ? mins
            : (hasTurnoHorarios
                ? (turnoHorariosMap.get(dow)?.carga_minutos ?? null)
                : minutosPrevistoDia);
        } else if (hasTurnoHorarios) {
          const th = turnoHorariosMap.get(dow);
          minutos_previstos = th?.carga_minutos ?? null;
        } else {
          minutos_previstos = minutosPrevistoDia;
        }
        if (minutos_previstos != null) {
          if (status === 'ocorrencia') {
            saldo_minutos = 0;
          } else {
            let raw = minutos - minutos_previstos;
            // Zero out saldo when within configured tolerance
            if (raw < 0 && Math.abs(raw) <= toleranciaAtraso) raw = 0;
            if (raw > 0 && raw <= toleranciaExtra) raw = 0;
            saldo_minutos = raw;
            saldoMes += saldo_minutos;
          }
        }
      }

      const batidasEsperadasHoje = hasTurnoHorarios
        ? batidasEsperadasDoDia(turnoHorariosMap.get(dow))
        : batidasEsperadasDia;

      // incompleto: derive from modifiers (set in cascade above) + cicloBatidas check
      const cicloBatidasIncompleto =
        batidasEsperadasHoje != null &&
        ehDiaTrabalho &&
        marcacoes.length > 0 &&
        marcacoes.length % batidasEsperadasHoje !== 0;

      if ((intervaloAberto || cicloBatidasIncompleto) && ehDiaTrabalho && marcacoes.length > 0) {
        if (!modifiers.includes('incompleto')) modifiers.push('incompleto');
      }
      const incompleto = modifiers.includes('incompleto');

      if (marcacoes.length) diasComMarcacao += 1;
      if (incompleto && marcacoes.length) diasIncompletos += 1;
      minutosMes += minutos;

      // Reference minutes = what the employee would normally work on this weekday,
      // regardless of feriado/folga status (used as baseline for 100pct_extra rule).
      let minutos_referencia;
      if (hasTurnoHorarios) {
        const th = turnoHorariosMap.get(dow);
        minutos_referencia = th?.trabalha ? (th.carga_minutos ?? minutosPrevistoDia ?? 0) : 0;
      } else {
        minutos_referencia = minutosPrevistoDia ?? 0;
      }
      let extras_100pct_minutos = calcExtras100pct({
        feriado,
        dow,
        lotacao,
        marcacoes,
        minutos_trabalhados: minutos,
        minutos_previstos: minutos_referencia,
        diaPrevisto,
      });
      let extras_50pct_minutos = 0;

      // dividir_extras_50_100: when a regular-day shift crosses midnight into a 100%-day
      // (Sunday or holiday), split at midnight — after-midnight hours = 100%, before = 50%.
      if (lotacao?.dividir_extras_50_100 && raw.length >= 2) {
        const minutosApos = minutosAposMeiaNoite(raw, data, tzOffsetMs);
        if (minutosApos > 0) {
          const nextDay = nextDateStr(data);
          const nextDow = (dow + 1) % 7;
          const nextFeriadoRaw = feriadosMap.get(nextDay) || null;
          const isNextFeriado = feriadoAfetaFuncionario(nextFeriadoRaw, funcionario);
          let tipoNextDay = null;
          if (isNextFeriado) tipoNextDay = lotacao.feriado_tipo;
          else if (nextDow === 0) tipoNextDay = lotacao.domingo_tipo;

          if (tipoNextDay && tipoNextDay !== 'nao_calcular' && tipoNextDay !== '50pct') {
            const minutosAntes = minutos - minutosApos;
            if (tipoNextDay === '100pct_total') {
              extras_100pct_minutos += minutosApos;
            } else if (tipoNextDay === '100pct_extra') {
              // Normal schedule is consumed first by before-midnight hours
              const normalUsadoAntes = Math.min(minutosAntes, minutos_referencia);
              const normalRestante = Math.max(0, minutos_referencia - normalUsadoAntes);
              extras_100pct_minutos += Math.max(0, minutosApos - normalRestante);
            }
            extras_50pct_minutos = Math.max(0, minutosAntes - minutos_referencia);
          }
        }
      }

      totalExtras100pct += extras_100pct_minutos;
      totalExtras50pct  += extras_50pct_minutos;

      // Noturno: count minutes in [noturnoInicio, 05:00) local; applies on any day with punches
      const minutos_noturno = raw.length >= 2 ? minutosNocturnosPar(raw, noturnoInicioMin, tzOffsetMs) : 0;
      totalMinutosNoturno += minutos_noturno;

      // Build expected punch times for justificativa automática
      let horarios_previstos = [];
      if (usaEscala && escalaEntry && escalaEntry.tipo === 'trabalho') {
        const campos = ['entrada1','saida1','entrada2','saida2','entrada3','saida3','entrada4','saida4'];
        horarios_previstos = campos.map((c) => escalaEntry[c]).filter(Boolean);
      } else if (hasTurnoHorarios) {
        const th = turnoHorariosMap.get(dow);
        if (th && th.trabalha) {
          horarios_previstos = [th.entrada, th.saida_intervalo, th.retorno_intervalo, th.saida].filter(Boolean);
        }
      } else if (funcionario) {
        horarios_previstos = [funcionario.turno_entrada, funcionario.turno_saida_intervalo, funcionario.turno_retorno_intervalo, funcionario.turno_saida].filter(Boolean);
      }

      return {
        data,
        dia_semana: dow,
        dia_semana_label: DIAS_PT[dow],
        status,
        modifiers,
        dia_trabalho: ehDiaTrabalho,
        feriado,
        horarios_previstos,
        ocorrencia: ocorrencia
          ? {
              id: ocorrencia.id,
              tipo: ocorrencia.tipo,
              descricao: ocorrencia.descricao || null,
              tipo_ocorrencia_descricao: ocorrencia.tipo_ocorrencia_descricao || null,
              tipo_lancamento: ocorrencia.tipo_lancamento || null,
              turno: ocorrencia.turno || null,
              quantidade_horas: ocorrencia.quantidade_horas != null ? Number(ocorrencia.quantidade_horas) : null,
            }
          : null,
        marcacoes,
        minutos_trabalhados: minutos,
        minutos_previstos,
        saldo_minutos,
        extras_100pct_minutos,
        extras_50pct_minutos,
        minutos_noturno,
        incompleto,
      };
    });

    return {
      ano: year,
      mes: month,
      meta: {
        funcionario_id: Number(funcionarioId),
        tz_offset: tzOffset,
        funcionario_nome: funcionario?.nome || null,
        funcionario_cargo: funcionario?.cargo || null,
        funcionario_matricula: funcionario?.matricula || null,
        funcionario_pis: funcionario?.pis || null,
        funcionario_cpf: funcionario?.cpf || null,
        funcionario_data_admissao: funcionario?.data_admissao
          ? String(funcionario.data_admissao).slice(0, 10)
          : null,
        empresa_razao_social: empresa?.razao_social || null,
        empresa_cnpj: empresa?.cnpj || null,
        empresa_endereco: empresa?.endereco || null,
        empresa_cidade: empresa?.cidade || null,
        empresa_uf: empresa?.uf || null,
        usa_escala: usaEscala ? 1 : 0,
        turno_id: turnoRow?.turno_id || null,
        turno_nome: turnoNome,
        turno_horario: buildTurnoHorario(funcionario || {}),
        minutos_previsto_dia_referencia: minutosPrevistoDia,
        dias_feriado_calendario: feriadosRows.length,
        batidas_esperadas_dia: batidasEsperadasDia,
      },
      dias,
      resumo: {
        minutos_trabalhados_mes: minutosMes,
        dias_com_marcacao: diasComMarcacao,
        dias_incompletos: diasIncompletos,
        total_marcacoes: rows.length,
        saldo_mes_minutos: minutosPrevistoDia != null ? saldoMes : null,
        dias_presentes: diasPresentes,
        dias_falta: diasFalta,
        dias_folga: diasFolga,
        dias_ocorrencia: diasOcorrencia,
        total_extras_100pct_minutos: totalExtras100pct,
        total_extras_50pct_minutos: totalExtras50pct,
        total_minutos_noturno: totalMinutosNoturno,
      },
    };
  },
};
