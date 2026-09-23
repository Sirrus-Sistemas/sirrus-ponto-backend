import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { query } from '../config/database.js';
import { BancoHorasRepository } from '../repositories/bancoHorasRepository.js';
import { parsePagination, paginatedResponse, successResponse } from '../utils/helpers.js';
import { auditar } from '../services/auditService.js';
import { fecharMesBancoHoras } from '../services/bancoHorasService.js';
import { gerarModeloBancoHoras, importarBancoHoras } from '../services/importBancoHorasService.js';

const lancamentoSchema = {
  body: {
    type: 'object',
    required: ['funcionario_id', 'data', 'mes_referencia', 'tipo', 'tipo_hora', 'minutos'],
    properties: {
      funcionario_id: { type: 'integer' },
      data: { type: 'string', format: 'date' },
      mes_referencia: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
      tipo: { type: 'string', enum: ['credito', 'debito'] },
      tipo_hora: { type: 'string', enum: ['50pct', '100pct'] },
      minutos: { type: 'integer', minimum: 1 },
      descricao: { type: ['string', 'null'] },
    },
  },
};

const fecharMesSchema = {
  body: {
    type: 'object',
    required: ['funcionario_id', 'ano', 'mes'],
    properties: {
      funcionario_id: { type: 'integer' },
      ano: { type: 'integer', minimum: 2000, maximum: 2100 },
      mes: { type: 'integer', minimum: 1, maximum: 12 },
    },
  },
};

async function carregarFuncionarioDaEmpresa(funcionarioId, empresaId) {
  const [func] = await query('SELECT id, nome FROM funcionarios WHERE id = ? AND empresa_id = ?', [funcionarioId, empresaId]);
  return func || null;
}

export default async function bancoHorasRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ─── Import do saldo do Sirrus Ponto Velox (migração única) ────────────────
  // Só permitido enquanto a empresa não tiver nenhum lançamento — evita
  // duplicar ou misturar histórico se rodado mais de uma vez.

  fastify.get('/banco-horas/importar/status', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const podeImportar = await BancoHorasRepository.empresaSemNenhumLancamento(request.empresaId);
    return successResponse({ pode_importar: podeImportar });
  });

  fastify.get('/banco-horas/importar/modelo', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const buffer = await gerarModeloBancoHoras();
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="modelo-banco-horas.xlsx"')
      .send(buffer);
  });

  fastify.post('/banco-horas/importar', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const podeImportar = await BancoHorasRepository.empresaSemNenhumLancamento(request.empresaId);
    if (!podeImportar) {
      return reply.code(409).send({
        error: 'Import não permitido',
        message: 'Esta empresa já tem lançamentos no banco de horas — o import do sistema antigo só é permitido uma vez, antes do primeiro lançamento.',
      });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ message: 'Envie a planilha .xlsx.' });
    const buffer = await file.toBuffer();

    const resultado = await importarBancoHoras(buffer, request.empresaId, request.user.id);
    if (resultado.erros) return reply.code(422).send({ message: 'Corrija os erros e envie novamente.', erros: resultado.erros });

    auditar({
      acao: 'INSERT',
      tabela: 'banco_horas',
      registro_id: request.empresaId,
      dados_anteriores: null,
      dados_novos: { origem: 'import_delphi', importados: resultado.importados },
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    return reply.code(201).send(successResponse(resultado, `${resultado.importados} lançamento(s) importado(s).`));
  });

  // ─── GET /banco-horas/:funcionarioId — saldo atual + extrato ───────────────
  fastify.get('/banco-horas/:funcionarioId', async (request, reply) => {
    const funcionarioId = parseInt(request.params.funcionarioId, 10);
    const func = await carregarFuncionarioDaEmpresa(funcionarioId, request.empresaId);
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const { page, limit, offset } = parsePagination(request.query);
    const [saldos, extrato, total] = await Promise.all([
      BancoHorasRepository.getSaldos(funcionarioId),
      BancoHorasRepository.listar(funcionarioId, { limit, offset }),
      BancoHorasRepository.contar(funcionarioId),
    ]);

    return successResponse({
      funcionario_id: funcionarioId,
      funcionario_nome: func.nome,
      ...saldos,
      ...paginatedResponse(extrato, total, page, limit),
    });
  });

  // ─── POST /banco-horas — lançamento manual (crédito ou débito) ────────────
  fastify.post('/banco-horas', {
    preHandler: [authorize('admin', 'gestor')],
    schema: lancamentoSchema,
  }, async (request, reply) => {
    const { funcionario_id, data, mes_referencia, tipo, tipo_hora, minutos, descricao } = request.body;

    const func = await carregarFuncionarioDaEmpresa(funcionario_id, request.empresaId);
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const resultado = await BancoHorasRepository.lancar({
      funcionario_id,
      data,
      mes_referencia,
      tipo,
      tipo_hora,
      minutos,
      descricao,
      origem: 'manual',
      created_by: request.user.id,
    });

    auditar({
      acao: 'INSERT',
      tabela: 'banco_horas',
      registro_id: resultado.id,
      dados_anteriores: null,
      dados_novos: { funcionario_id, data, mes_referencia, tipo, tipo_hora, minutos, descricao },
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    return reply.code(201).send(successResponse(resultado, 'Lançamento gravado no banco de horas'));
  });

  // ─── DELETE /banco-horas/:id — exclui um lançamento (manual ou fechamento) ──
  // Excluir um fechamento_mensal reabre aquele mês/tipo de hora pra ser
  // fechado de novo (tiposJaFechados deixa de encontrá-lo) — é assim que se
  // corrige um fechamento feito com a ficha ainda incompleta. Fica registrado
  // por inteiro em audit_log (quem excluiu, quando, e o lançamento inteiro
  // que existia antes), já que apagar um fechamento reescreve histórico.
  fastify.delete('/banco-horas/:id', {
    preHandler: [authorize('admin', 'gestor')],
  }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);

    const linha = await BancoHorasRepository.buscarPorId(id);
    if (!linha || linha.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Lançamento não encontrado' });
    }

    const excluida = await BancoHorasRepository.excluir(id);

    auditar({
      acao: 'DELETE',
      tabela: 'banco_horas',
      registro_id: id,
      dados_anteriores: excluida,
      dados_novos: null,
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    return successResponse(null, 'Lançamento excluído do banco de horas');
  });

  // ─── POST /banco-horas/fechar-mes — fechamento automático a partir da ficha ─
  fastify.post('/banco-horas/fechar-mes', {
    preHandler: [authorize('admin', 'gestor')],
    schema: fecharMesSchema,
  }, async (request, reply) => {
    const { funcionario_id, ano, mes } = request.body;

    const func = await carregarFuncionarioDaEmpresa(funcionario_id, request.empresaId);
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const resultado = await fecharMesBancoHoras(funcionario_id, request.empresaId, ano, mes, request.user.id);

    auditar({
      acao: 'INSERT',
      tabela: 'banco_horas',
      registro_id: funcionario_id,
      dados_anteriores: null,
      dados_novos: resultado,
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    const msg = resultado.lancamentos.length > 0
      ? `Mês ${resultado.mes_referencia} fechado: ${resultado.lancamentos.length} lançamento(s).`
      : `Mês ${resultado.mes_referencia} fechado sem saldo a lançar.`;
    return successResponse(resultado, msg);
  });
}
