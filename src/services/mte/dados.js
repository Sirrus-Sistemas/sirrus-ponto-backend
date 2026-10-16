// Monta o contexto dos arquivos do MTE (ver geradores.js) a partir do mesmo
// cálculo do Espelho de Ponto — os arquivos batem com a Ficha/Espelho.

import { query } from '../../config/database.js';
import { EspelhoPontoService, fusoHorarioToTzOffset } from '../espelhoPontoService.js';
import { identificacaoEmpregador, horaParaMinutos } from './comum.js';

/** Meses (ano, mês) cobertos pelo período. */
function mesesDoPeriodo(inicio, fim) {
  const meses = [];
  let [y, m] = inicio.slice(0, 7).split('-').map(Number);
  const [yf, mf] = fim.slice(0, 7).split('-').map(Number);
  while (y < yf || (y === yf && m <= mf)) {
    meses.push([y, m]);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return meses;
}

/** Filial da empresa + identificação do empregador + fuso. null se não existir. */
export async function carregarFilial(empresaId, filialId) {
  const [f] = await query(
    `SELECT fi.id, fi.nome, fi.cnpj, e.razao_social, mu.fuso_horario
       FROM filiais fi
       JOIN empresas e ON e.id = fi.empresa_id
       LEFT JOIN municipios mu ON mu.CODMUNICIPIO = e.municipio_id
      WHERE fi.id = ? AND fi.empresa_id = ?`,
    [filialId, empresaId],
  );
  if (!f) return null;
  const { tipo, documento } = identificacaoEmpregador(f.cnpj);
  return {
    filial: { id: f.id, tz: fusoHorarioToTzOffset(f.fuso_horario) },
    empregador: { tipo, documento, razao: f.nome || f.razao_social },
  };
}

/**
 * Contexto completo para AFDT / ACJEF / AEJ: funcionários da filial (e
 * lotação, se informada) que controlam ponto — ativos ou com batida no
 * período — com os dias do espelho dentro do período.
 */
export async function carregarContexto({ empresaId, filialId, lotacaoId, inicio, fim, versaoPrograma }) {
  const base = await carregarFilial(empresaId, filialId);
  if (!base) return null;

  const params = [empresaId, filialId];
  let filtroLotacao = '';
  if (lotacaoId) { filtroLotacao = ' AND f.lotacao_id = ?'; params.push(lotacaoId); }
  params.push(inicio, fim);
  const funcs = await query(
    `SELECT f.id, f.nome, f.cpf, f.pis, f.matricula, f.turno_id, f.usa_banco_horas, l.tipo_extra
       FROM funcionarios f
       LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      WHERE f.empresa_id = ? AND f.filial_id = ? AND f.controla_ponto = 1${filtroLotacao}
        AND (f.ativo = 1 OR EXISTS (
              SELECT 1 FROM marcacoes m
               WHERE m.funcionario_id = f.id
                 AND COALESCE(m.dia_referencia, DATE(m.data_hora)) BETWEEN ? AND ?))
      ORDER BY f.nome`,
    params,
  );

  const meses = mesesDoPeriodo(inicio, fim);
  const funcionarios = [];
  for (const f of funcs) {
    const dias = [];
    let tz = base.filial.tz;
    for (const [ano, mes] of meses) {
      const esp = await EspelhoPontoService.buildEspelho(f.id, empresaId, ano, mes);
      tz = esp.meta?.tz_offset || tz;
      for (const d of esp.dias) if (d.data >= inicio && d.data <= fim) dias.push(d);
    }
    funcionarios.push({ ...f, tz, dias });
  }

  // Relógio de cada batida REP (nº de série e modelo para AFDT/AEJ).
  const idsRep = funcionarios.flatMap((f) => f.dias.flatMap((d) => [
    ...(d.marcacoes || []), ...(d.marcacoes_desconsideradas || []),
  ].filter((m) => m.tipo === 'rep').map((m) => m.id)));
  const relogioDaMarcacao = new Map();
  for (let i = 0; i < idsRep.length; i += 1000) {
    const lote = idsRep.slice(i, i + 1000);
    const rows = await query(
      `SELECT m.id AS marcacao_id, r.id, r.numero_serie, r.modelo
         FROM marcacoes m JOIN relogios_ponto r ON r.id = m.relogio_id
        WHERE m.id IN (${lote.map(() => '?').join(',')})`,
      lote,
    );
    for (const r of rows) relogioDaMarcacao.set(r.marcacao_id, { id: r.id, numero_serie: r.numero_serie, modelo: r.modelo });
  }

  // Horários contratuais dos turnos usados (registro 2 do ACJEF / 04 do AEJ).
  const idsTurno = [...new Set(funcionarios.map((f) => f.turno_id).filter(Boolean))];
  const turnos = [];
  if (idsTurno.length) {
    const rows = await query(
      `SELECT t.id, t.entrada, t.saida_intervalo, t.retorno_intervalo, t.saida, t.carga_horaria_diaria,
              th.entrada AS seg_entrada, th.saida_intervalo AS seg_saida_intervalo,
              th.retorno_intervalo AS seg_retorno_intervalo, th.saida AS seg_saida, th.carga_minutos AS seg_carga
         FROM turnos t
         LEFT JOIN turno_horarios th ON th.turno_id = t.id AND th.dia_semana = 1 AND th.trabalha = 1
        WHERE t.id IN (${idsTurno.map(() => '?').join(',')})
        ORDER BY t.id`,
      idsTurno,
    );
    for (const t of rows) {
      // Turno com tabela por dia da semana: usa a segunda-feira (mesmo critério do legado).
      const usaSegunda = !t.entrada && t.seg_entrada;
      const horarios = usaSegunda
        ? [t.seg_entrada, t.seg_saida_intervalo, t.seg_retorno_intervalo, t.seg_saida]
        : [t.entrada, t.saida_intervalo, t.retorno_intervalo, t.saida];
      const pares = [[horarios[0], horarios[1] && horarios[2] ? horarios[1] : horarios[3]], [horarios[2], horarios[3]]];
      const cargaCalc = pares.reduce((s, [a, b]) => (a && b ? s + Math.max(0, horaParaMinutos(b) - horaParaMinutos(a)) : s), 0);
      turnos.push({
        id: t.id,
        horarios: horarios.map((h) => (h ? String(h).slice(0, 5) : null)),
        cargaMinutos: usaSegunda && t.seg_carga ? Number(t.seg_carga)
          : (t.carga_horaria_diaria ? horaParaMinutos(t.carga_horaria_diaria) : cargaCalc),
      });
    }
  }

  return {
    ...base,
    tz: base.filial.tz,
    inicio,
    fim,
    geradoEm: new Date(),
    funcionarios,
    turnos,
    relogioDaMarcacao,
    versaoPrograma,
  };
}
