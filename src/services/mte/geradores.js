// Geradores AFDT, ACJEF (Portaria 1510) e AEJ (Portaria 671). Funções puras:
// recebem o contexto montado em dados.js (empregador, funcionários com os dias
// já calculados pelo espelho, turnos, relógios) e devolvem as linhas.
//
// Contexto:
//   inicio, fim            "YYYY-MM-DD"
//   geradoEm               Date
//   tz                     fuso da filial ("-04:00") — data/hora de geração
//   empregador             { tipo: '1'|'2', documento, razao }
//   funcionarios[]         { id, nome, cpf, pis, matricula, turno_id, usa_banco_horas,
//                            tipo_extra, tz, dias[] }  (dias = saída do espelho)
//   turnos[]               { id, cargaMinutos, horarios: ['08:00', '12:00', ...] }
//   relogioDaMarcacao      Map(marcacao_id → { id, numero_serie, modelo })
//   versaoPrograma         "1.2.3"

import {
  DESENVOLVEDOR, NUMERO_REP_P,
  alfa, campo, ddmmaaaa, digitos, hhmm, horaParaMinutos, horaSemDoisPontos, num,
  offsetCompacto, offsetMs, percentualExtra,
} from './comum.js';

// ── Batidas tratadas de um dia ──────────────────────────────────────────────

/**
 * Batidas de um dia na ordem da jornada (como na Ficha), com o tipo de cada
 * uma: E/S pela posição no par, D para desconsiderada; origem O (relógio/app)
 * ou I (lançada manualmente).
 */
function batidasDoDia(dia) {
  const tratadas = (dia.marcacoes || []).map((m, i) => ({
    ...m,
    tipoMarc: i % 2 === 0 ? 'E' : 'S',
    par: Math.floor(i / 2) + 1,
    origem: m.tipo === 'manual' ? 'I' : 'O',
  }));
  const desconsideradas = (dia.marcacoes_desconsideradas || []).map((m) => ({
    ...m, tipoMarc: 'D', par: 0, origem: 'O',
  }));
  return [...tratadas, ...desconsideradas];
}

const motivoDaBatida = (b) => (b.origem === 'I' ? (b.motivo_edicao || 'INCLUSAO MANUAL') : '');
const localDaBatida = (b) => String(b.data_hora_local ?? b.data_hora); // "YYYY-MM-DDThh:mm:ss"

function numeroRepDaBatida(ctx, b) {
  const r = b.tipo === 'rep' ? ctx.relogioDaMarcacao.get(b.id) : null;
  return r ? num(r.numero_serie, 17) : NUMERO_REP_P;
}

// ── Portaria 1510: cabeçalho comum do AFDT e do ACJEF ────────────────────────

function cabecalho1510(ctx, sequencial) {
  const ger = new Date(ctx.geradoEm.getTime() + offsetMs(ctx.tz)).toISOString(); // horário local
  return num(sequencial, 9) + '1'
    + ctx.empregador.tipo
    + num(ctx.empregador.documento, 14)
    + num('', 12)                       // CEI (não cadastrado)
    + alfa(ctx.empregador.razao, 150)
    + ddmmaaaa(ctx.inicio) + ddmmaaaa(ctx.fim)
    + ddmmaaaa(ger.slice(0, 10)) + ger.slice(11, 13) + ger.slice(14, 16);
}

const pisDoFuncionario = (f) => num(digitos(f.pis) || digitos(f.cpf), 12);

// ── AFDT — Arquivo Fonte de Dados Tratados (Portaria 1510) ───────────────────

export function gerarAFDT(ctx) {
  const linhas = [cabecalho1510(ctx, 1)];
  let seq = 1;
  for (const f of ctx.funcionarios) {
    for (const dia of f.dias) {
      for (const b of batidasDoDia(dia)) {
        const local = localDaBatida(b);
        linhas.push(
          num(++seq, 9) + '2'
          + ddmmaaaa(local.slice(0, 10)) + local.slice(11, 13) + local.slice(14, 16)
          + pisDoFuncionario(f)
          + numeroRepDaBatida(ctx, b)
          + b.tipoMarc
          + num(b.par, 2)
          + b.origem
          + alfa(motivoDaBatida(b), 100),
        );
      }
    }
  }
  linhas.push(num(++seq, 9) + '9');
  return linhas;
}

// ── ACJEF — Arquivo de Controle de Jornada para Efeitos Fiscais (Portaria 1510)

/** Dia entra no ACJEF: já passou e tinha jornada prevista ou teve batida. */
const diaComJornada = (d) => d.status !== 'futuro' && ((d.minutos_previstos ?? 0) > 0 || (d.marcacoes?.length ?? 0) > 0);

export function gerarACJEF(ctx) {
  const linhas = [cabecalho1510(ctx, 1)];
  let seq = 1;

  // Registro 2: horários contratuais (código = id do turno).
  for (const t of ctx.turnos) {
    const [ent, saiInt, retInt, sai] = t.horarios;
    linhas.push(
      num(++seq, 9) + '2' + num(t.id, 4)
      + num(horaSemDoisPontos(ent), 4)
      + num(horaSemDoisPontos(sai ?? saiInt), 4)
      + num(horaSemDoisPontos(sai ? saiInt : ''), 4)
      + num(horaSemDoisPontos(sai ? retInt : ''), 4),
    );
  }

  // Registro 3: um por dia de jornada de cada funcionário.
  for (const f of ctx.funcionarios) {
    const pctHe1 = percentualExtra(f.tipo_extra);
    for (const d of f.dias.filter(diaComJornada)) {
      const trabalhado = d.minutos_trabalhados ?? 0;
      const he50 = d.extras_50pct_minutos ?? 0;
      const he100 = d.extras_100pct_minutos ?? 0;
      const normais = Math.max(0, trabalhado - he50 - he100);
      const noturnasNormais = Math.min(d.minutos_noturno ?? 0, normais);
      const diurnasNormais = normais - noturnasNormais;

      const primeira = d.marcacoes?.[0] ? localDaBatida(d.marcacoes[0]) : null;
      const entrada = primeira ? primeira.slice(11, 13) + primeira.slice(14, 16) : '0000';
      // Modalidade igual ao legado: entrada depois das 22:00 = noturna.
      const modalidade = primeira && horaParaMinutos(primeira.slice(11, 16)) > 22 * 60 ? 'N' : 'D';

      // Banco de horas: o saldo do dia vai para compensação (sinal 1 = somar,
      // 2 = subtrair) e não para faltas. Sem banco: débito vira falta/atraso.
      const saldo = d.saldo_minutos ?? 0;
      const banco = Number(f.usa_banco_horas) === 1;
      const faltas = !banco && saldo < 0 ? -saldo : 0;
      const sinal = banco && saldo < 0 ? '2' : '1';
      const compensar = banco ? Math.abs(saldo) : 0;

      linhas.push(
        num(++seq, 9) + '3'
        + pisDoFuncionario(f)
        + ddmmaaaa(d.data)
        + entrada
        + num(f.turno_id ?? 0, 4)
        + hhmm(diurnasNormais)
        + hhmm(noturnasNormais)
        + hhmm(he50) + (he50 ? pctHe1 : '0000') + (he50 ? modalidade : ' ')
        + hhmm(he100) + (he100 ? '1000' : '0000') + (he100 ? modalidade : ' ')
        + '00000000 ' + '00000000 '      // horas extras 3 e 4 (não usadas)
        + hhmm(faltas)
        + sinal
        + hhmm(compensar),
      );
    }
  }
  linhas.push(num(++seq, 9) + '9');
  return linhas;
}

// ── AEJ — Arquivo Eletrônico de Jornada (Portaria 671) ───────────────────────

/** Tipo do REP no AEJ: 1 = REP-C, 2 = REP-A/1510, 3 = REP-P. Mesmo critério do legado. */
const tipoRep = (modelo) => (String(modelo || '').includes('671') ? '1' : '2');

export function gerarAEJ(ctx) {
  const linhas = [];
  const qtd = { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0 };
  const add = (tipo, campos) => { qtd[tipo] += 1; linhas.push([tipo, ...campos].join('|')); };

  const ger = new Date(ctx.geradoEm.getTime() + offsetMs(ctx.tz)).toISOString();
  add('01', [
    ctx.empregador.tipo,
    ctx.empregador.documento,
    '',                                 // CAEPF
    '',                                 // CNO
    campo(ctx.empregador.razao),
    ctx.inicio,
    ctx.fim,
    `${ger.slice(0, 16)}:00${offsetCompacto(ctx.tz)}`,
    '001',
  ]);

  // 02 — REPs usados no período (relógios das batidas + o REP-P do sistema).
  const reps = new Map();
  for (const f of ctx.funcionarios) {
    for (const d of f.dias) {
      for (const b of batidasDoDia(d)) {
        const r = b.tipo === 'rep' ? ctx.relogioDaMarcacao.get(b.id) : null;
        if (r && !reps.has(String(r.id))) reps.set(String(r.id), [String(r.id), tipoRep(r.modelo), num(r.numero_serie, 17)]);
        if (!r && !reps.has(NUMERO_REP_P)) reps.set(NUMERO_REP_P, [NUMERO_REP_P, '3', NUMERO_REP_P]);
      }
    }
  }
  for (const r of reps.values()) add('02', r);

  // 03 — vínculos (sem CPF não entra: o AEJ identifica o trabalhador pelo CPF).
  const comCpf = ctx.funcionarios.filter((f) => digitos(f.cpf).length === 11);
  for (const f of comCpf) add('03', [String(f.id), digitos(f.cpf), campo(f.nome).slice(0, 150)]);

  // 04 — horários contratuais: código | duração (min) | entrada | saída | ...
  for (const t of ctx.turnos) {
    add('04', [String(t.id), String(t.cargaMinutos), ...t.horarios.filter(Boolean).map(horaSemDoisPontos)]);
  }

  // 05 — marcações tratadas.
  for (const f of comCpf) {
    for (const d of f.dias) {
      for (const b of batidasDoDia(d)) {
        const r = b.tipo === 'rep' ? ctx.relogioDaMarcacao.get(b.id) : null;
        const local = localDaBatida(b);
        add('05', [
          String(f.id),
          `${local.slice(0, 16)}:00${offsetCompacto(f.tz)}`,
          r ? String(r.id) : NUMERO_REP_P,
          b.tipoMarc,
          b.tipoMarc === 'D' ? '' : String(b.par),
          b.origem,
          f.turno_id ? String(f.turno_id) : '',
          campo(motivoDaBatida(b)),
        ]);
      }
    }
  }

  // 06 — matrícula (eSocial).
  for (const f of comCpf) if (f.matricula) add('06', [String(f.id), campo(f.matricula)]);

  // 07 — ausências: falta não justificada (tipo 2).
  for (const f of comCpf) {
    for (const d of f.dias) if (d.status === 'falta') add('07', [String(f.id), '2', d.data, '', '']);
  }

  // 08 — programa de tratamento.
  add('08', [
    DESENVOLVEDOR.programa, ctx.versaoPrograma, DESENVOLVEDOR.tipoIdentificacao,
    DESENVOLVEDOR.cnpj, DESENVOLVEDOR.razaoSocial, DESENVOLVEDOR.email,
  ]);

  linhas.push(['99', ...Object.values(qtd).map(String)].join('|'));
  return { linhas, semCpf: ctx.funcionarios.filter((f) => digitos(f.cpf).length !== 11).map((f) => f.nome) };
}
