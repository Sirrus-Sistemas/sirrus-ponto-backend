import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { successResponse } from '../utils/helpers.js';
import { RelogioRepository } from '../repositories/relogioRepository.js';
import { RelogioSyncRepository } from '../repositories/relogioSyncRepository.js';
import { MarcacaoRepository } from '../repositories/marcacaoRepository.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';

const MODELOS_VALIDOS = [
  'arquivo_afd', 'control_id', 'control_id_class', 'control_id_class_671',
  'henry_super_facil', 'henry_sf_advanced', 'arquivo_afd_671', 'idface_671', 'henry_1510',
];

const marcacoesImportarSchema = {
  body: {
    type: 'object',
    required: ['relogio_id', 'marcacoes'],
    properties: {
      relogio_id: { type: 'integer', minimum: 1 },
      marcacoes: {
        type: 'array',
        maxItems: 5000,
        items: {
          type: 'object',
          required: ['nsr', 'data_hora'],
          properties: {
            nsr: { type: 'integer', minimum: 0 },
            cpf: { type: 'string', nullable: true },
            pis: { type: 'string', nullable: true },
            data_hora: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
  },
};

export default async function relogiosRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ── GET /api/relogios
  fastify.get('/relogios', { preHandler: [authorize('admin')] }, async (request) => {
    const relogios = await RelogioRepository.findByEmpresa(request.empresaId);
    return successResponse(relogios);
  });

  // ── GET /api/relogios/sync  (para o sistema de coleta local)
  fastify.get('/relogios/sync', { preHandler: [authorize('admin')] }, async (request) => {
    const relogios = await RelogioRepository.findForSync(request.empresaId);
    return successResponse(relogios, 'Relógios sincronizados');
  });

  // ── GET /api/relogios/:id
  fastify.get('/relogios/:id', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogio = await RelogioRepository.findById(Number(request.params.id), request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });
    return successResponse(relogio);
  });

  // ── POST /api/relogios
  fastify.post('/relogios', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['numero_serie', 'descricao', 'modelo'],
        properties: {
          numero_serie: { type: 'string', minLength: 1, maxLength: 100 },
          descricao:    { type: 'string', minLength: 1, maxLength: 200 },
          modelo:       { type: 'string', enum: MODELOS_VALIDOS },
          ip:           { type: 'string', nullable: true },
          porta:        { type: 'integer', minimum: 1, maximum: 65535, nullable: true },
          usuario:      { type: 'string', nullable: true },
          senha:        { type: 'string', nullable: true },
          usa_afd:      { type: 'boolean', default: false },
          filial_id:    { type: 'integer', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const id = await RelogioRepository.create(request.empresaId, request.body);
    const relogio = await RelogioRepository.findById(id, request.empresaId);
    return reply.code(201).send(successResponse(relogio, 'Relógio cadastrado com sucesso.'));
  });

  // ── PUT /api/relogios/:id
  fastify.put('/relogios/:id', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const exists = await RelogioRepository.findById(id, request.empresaId);
    if (!exists) return reply.code(404).send({ message: 'Relógio não encontrado.' });
    await RelogioRepository.update(id, request.empresaId, request.body);
    const updated = await RelogioRepository.findById(id, request.empresaId);
    return successResponse(updated, 'Relógio atualizado com sucesso.');
  });

  // ── DELETE /api/relogios/:id
  fastify.delete('/relogios/:id', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const exists = await RelogioRepository.findById(id, request.empresaId);
    if (!exists) return reply.code(404).send({ message: 'Relógio não encontrado.' });
    await RelogioRepository.remove(id, request.empresaId);
    return successResponse(null, 'Relógio removido com sucesso.');
  });

  // ══════════════════════════════════════════════════════════════════
  // SAÚDE / HEARTBEAT — sistema de coleta local
  // ══════════════════════════════════════════════════════════════════

  // ── POST /api/relogios/heartbeat  (sistema local → API)
  fastify.post('/relogios/heartbeat', { preHandler: [authorize('admin')] }, async (request) => {
    const { versao, status, ultimo_sync, relogios } = request.body ?? {};
    await RelogioSyncRepository.upsertHeartbeat(request.empresaId, { versao, status, ultimo_sync, relogios });
    return successResponse(null, 'Heartbeat registrado.');
  });

  // ── GET /api/relogios/saude  (frontend)
  fastify.get('/relogios/saude', { preHandler: [authorize('admin')] }, async (request) => {
    const saude = await RelogioSyncRepository.getSaude(request.empresaId);
    return successResponse(saude);
  });

  // ══════════════════════════════════════════════════════════════════
  // FILA DE SINCRONIZAÇÃO — sistema de coleta local
  // ══════════════════════════════════════════════════════════════════

  // ── GET /api/relogios/fila?relogio_id=X  (polling pelo sistema local)
  fastify.get('/relogios/fila', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogioId = Number(request.query.relogio_id);
    if (!relogioId) return reply.code(400).send({ message: 'Informe relogio_id.' });

    const relogio = await RelogioRepository.findById(relogioId, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const itens = await RelogioSyncRepository.findPendingByRelogio(relogioId);
    return successResponse(itens);
  });

  // ── POST /api/relogios/fila/ack  (confirmação do sistema de coleta local)
  fastify.post('/relogios/fila/ack', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const { fila_id, status, erro_msg } = request.body ?? {};
    if (!fila_id || !status) return reply.code(400).send({ message: 'Informe fila_id e status.' });
    if (!['enviado', 'erro'].includes(status)) return reply.code(400).send({ message: 'status deve ser "enviado" ou "erro".' });

    await RelogioSyncRepository.ack(fila_id, status, erro_msg ?? null);
    return successResponse(null, 'Confirmação registrada.');
  });

  // ══════════════════════════════════════════════════════════════════
  // MARCAÇÕES — coleta de ponto pelo sistema de coleta local
  // ══════════════════════════════════════════════════════════════════

  // ── GET /api/relogios/ultimo-nsr?relogio_id=X  (sistema de coleta local)
  fastify.get('/relogios/ultimo-nsr', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogioId = Number(request.query.relogio_id);
    if (!relogioId) return reply.code(400).send({ message: 'Informe relogio_id.' });

    const relogio = await RelogioRepository.findById(relogioId, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const ultimoNsr = await MarcacaoRepository.ultimoNsrPorRelogio(relogioId);
    return successResponse({ ultimo_nsr: ultimoNsr });
  });

  // ── POST /api/relogios/marcacoes  (sistema de coleta local)
  fastify.post('/relogios/marcacoes', {
    preHandler: [authorize('admin')],
    schema: marcacoesImportarSchema,
  }, async (request, reply) => {
    const { relogio_id, marcacoes } = request.body;

    const relogio = await RelogioRepository.findById(relogio_id, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const resultados = [];
    for (const m of marcacoes) {
      if (!m.cpf && !m.pis) {
        resultados.push({ nsr: m.nsr, status: 'funcionario_nao_encontrado' });
        continue;
      }

      const funcionarioId = await FuncionarioRepository.findByCpfOuPis(request.empresaId, { cpf: m.cpf, pis: m.pis });
      if (!funcionarioId) {
        resultados.push({ nsr: m.nsr, status: 'funcionario_nao_encontrado' });
        continue;
      }

      const inserida = await MarcacaoRepository.insertFromRelogio({
        funcionarioId,
        relogioId: relogio_id,
        nsr: m.nsr,
        dataHora: m.data_hora,
      });
      resultados.push({ nsr: m.nsr, status: inserida ? 'inserida' : 'duplicada' });
    }

    return reply.code(201).send(successResponse(resultados, 'Marcações processadas.'));
  });

  // ══════════════════════════════════════════════════════════════════
  // COMUNICAÇÃO — interface do frontend
  // ══════════════════════════════════════════════════════════════════

  // ── GET /api/relogios/comunicacao?relogio_id=X&status=pendente&search=
  fastify.get('/relogios/comunicacao', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogioId = Number(request.query.relogio_id);
    if (!relogioId) return reply.code(400).send({ message: 'Informe relogio_id.' });

    const relogio = await RelogioRepository.findById(relogioId, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const itens = await RelogioSyncRepository.findByRelogio(relogioId, {
      status: request.query.status || undefined,
      search: request.query.search || undefined,
    });
    return successResponse(itens);
  });

  // ── GET /api/relogios/comunicacao/contadores
  fastify.get('/relogios/comunicacao/contadores', { preHandler: [authorize('admin')] }, async (request) => {
    const contadores = await RelogioSyncRepository.countPendingByEmpresa(request.empresaId);
    return successResponse(contadores);
  });

  // ── POST /api/relogios/comunicacao/enqueue  (enfileirar manual — ex: excluir)
  fastify.post('/relogios/comunicacao/enqueue', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const { relogio_id, funcionario_id, operacao } = request.body ?? {};
    if (!relogio_id || !funcionario_id || !operacao) {
      return reply.code(400).send({ message: 'Informe relogio_id, funcionario_id e operacao.' });
    }
    if (!['inserir', 'atualizar', 'excluir'].includes(operacao)) {
      return reply.code(400).send({ message: 'operacao deve ser inserir, atualizar ou excluir.' });
    }

    const relogio = await RelogioRepository.findById(Number(relogio_id), request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    await RelogioSyncRepository.enqueue(Number(relogio_id), Number(funcionario_id), operacao);
    return successResponse(null, 'Funcionário adicionado à fila.');
  });

  // ── POST /api/relogios/comunicacao/retentar?relogio_id=X
  fastify.post('/relogios/comunicacao/retentar', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogioId = Number(request.query.relogio_id);
    if (!relogioId) return reply.code(400).send({ message: 'Informe relogio_id.' });

    const relogio = await RelogioRepository.findById(relogioId, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const total = await RelogioSyncRepository.retryErrors(relogioId);
    return successResponse({ total }, `${total} item(ns) marcado(s) para reenvio.`);
  });

  // ── DELETE /api/relogios/comunicacao/:filaId?relogio_id=X
  fastify.delete('/relogios/comunicacao/:filaId', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const relogioId = Number(request.query.relogio_id);
    const filaId    = Number(request.params.filaId);
    if (!relogioId) return reply.code(400).send({ message: 'Informe relogio_id.' });

    const relogio = await RelogioRepository.findById(relogioId, request.empresaId);
    if (!relogio) return reply.code(404).send({ message: 'Relógio não encontrado.' });

    const removed = await RelogioSyncRepository.remove(filaId, relogioId);
    if (!removed) return reply.code(404).send({ message: 'Item não encontrado na fila.' });
    return successResponse(null, 'Item removido da fila.');
  });
}
