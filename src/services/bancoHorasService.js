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
  const net100 = resumo.total_extras_100pct_minutos || 0;

  const candidatos = [
    net50 !== 0 && { tipo_hora: '50pct', tipo: net50 > 0 ? 'credito' : 'debito', minutos: Math.abs(net50) },
    net100 !== 0 && { tipo_hora: '100pct', tipo: 'credito', minutos: net100 },
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
