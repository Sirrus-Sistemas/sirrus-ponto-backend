import { query } from '../config/database.js';
import { BancoHorasRepository } from '../repositories/bancoHorasRepository.js';
import { EspelhoPontoService } from './espelhoPontoService.js';

/**
 * Fecha o banco de horas de um mês: soma o saldo líquido de extras 50%/100%
 * e débito da ficha de ponto daquele mês e grava até 2 lançamentos (um por
 * tipo_hora, só quando o saldo líquido não é zero). Não fecha de novo um
 * tipo_hora que já tenha um fechamento gravado pra esse mês — se o admin
 * precisar corrigir, tem que lançar um ajuste manual, não reabrir o fechamento.
 */
export async function fecharMesBancoHoras(funcionarioId, empresaId, ano, mes, createdBy) {
  const mesReferencia = `${ano}-${String(mes).padStart(2, '0')}`;

  const jaFechados = await BancoHorasRepository.tiposJaFechados(funcionarioId, mesReferencia);

  const espelho = await EspelhoPontoService.buildEspelho(funcionarioId, empresaId, ano, mes);
  const { resumo } = espelho;

  const net50 = (resumo.total_extras_50pct_minutos || 0) - (resumo.total_debito_minutos || 0);
  const net100 = (resumo.total_extras_100pct_minutos || 0) - (resumo.total_debito_100pct_minutos || 0);

  const candidatos = [
    net50 !== 0 && { tipo_hora: '50pct', tipo: net50 > 0 ? 'credito' : 'debito', minutos: Math.abs(net50) },
    net100 !== 0 && { tipo_hora: '100pct', tipo: net100 > 0 ? 'credito' : 'debito', minutos: Math.abs(net100) },
  ].filter(Boolean);

  const jaFechadosNestaChamada = candidatos.filter((c) => jaFechados.includes(c.tipo_hora));
  if (jaFechadosNestaChamada.length > 0) {
    const tipos = jaFechadosNestaChamada.map((c) => (c.tipo_hora === '50pct' ? '50%' : '100%')).join(' e ');
    const err = new Error(`O mês ${mesReferencia} já foi fechado para ${tipos} deste funcionário.`);
    err.statusCode = 409;
    throw err;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const lancamentos = [];
  for (const c of candidatos) {
    const { id, saldo_anterior, saldo_posterior } = await BancoHorasRepository.lancar({
      funcionario_id: funcionarioId,
      data: hoje,
      mes_referencia: mesReferencia,
      tipo: c.tipo,
      tipo_hora: c.tipo_hora,
      minutos: c.minutos,
      descricao: `Fechamento automático da ficha de ${mesReferencia}`,
      origem: 'fechamento_mensal',
      created_by: createdBy,
    });
    lancamentos.push({ id, tipo_hora: c.tipo_hora, tipo: c.tipo, minutos: c.minutos, saldo_anterior, saldo_posterior });
  }

  return { mes_referencia: mesReferencia, lancamentos };
}

/**
 * Fecha o mês de todos os funcionários da empresa que usam banco de horas de
 * uma vez só — um funcionário com erro (ex.: mês já fechado, sem jornada
 * configurada) não impede os demais; cada resultado é reportado individualmente
 * pra tela mostrar quem fechou, quem não tinha saldo e quem não pôde ser
 * calculado (com o motivo), em vez de só um total agregado.
 */
export async function fecharMesTodosFuncionarios(empresaId, ano, mes, createdBy, { filialId, lotacaoId } = {}) {
  const mesReferencia = `${ano}-${String(mes).padStart(2, '0')}`;

  const condicoes = ['empresa_id = ?', 'ativo = 1', 'usa_banco_horas = 1'];
  const params = [empresaId];
  if (filialId) { condicoes.push('filial_id = ?'); params.push(filialId); }
  if (lotacaoId) { condicoes.push('lotacao_id = ?'); params.push(lotacaoId); }
  const funcionarios = await query(
    `SELECT id, nome FROM funcionarios WHERE ${condicoes.join(' AND ')} ORDER BY nome`,
    params,
  );

  const resultados = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < funcionarios.length; i += CONCURRENCY) {
    const lote = funcionarios.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      lote.map((f) => fecharMesBancoHoras(f.id, empresaId, ano, mes, createdBy)),
    );
    settled.forEach((r, j) => {
      const f = lote[j];
      if (r.status === 'fulfilled') {
        resultados.push({
          funcionario_id: f.id,
          funcionario_nome: f.nome,
          status: r.value.lancamentos.length > 0 ? 'fechado' : 'sem_saldo',
          lancamentos: r.value.lancamentos,
          motivo: null,
        });
      } else {
        resultados.push({
          funcionario_id: f.id,
          funcionario_nome: f.nome,
          status: r.reason?.statusCode === 409 ? 'ja_fechado' : 'erro',
          lancamentos: [],
          motivo: r.reason?.message || 'Erro desconhecido ao calcular a ficha do mês.',
        });
      }
    });
  }

  return {
    mes_referencia: mesReferencia,
    total: funcionarios.length,
    fechados: resultados.filter((r) => r.status === 'fechado').length,
    sem_saldo: resultados.filter((r) => r.status === 'sem_saldo').length,
    ja_fechado: resultados.filter((r) => r.status === 'ja_fechado').length,
    nao_calculados: resultados.filter((r) => r.status === 'erro'),
    resultados,
  };
}
