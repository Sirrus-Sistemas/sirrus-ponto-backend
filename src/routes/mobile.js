import { authenticate, empresaScope } from '../middlewares/auth.js';
import { successResponse } from '../utils/helpers.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import {
  syncFilial,
  syncFuncionario,
  syncAllFuncionarios,
  pullMarcacoes,
  listarBloqueadas,
  desbloquearBloqueada,
  isMobileConfigured,
  listarPendentesAprovacao,
  decidirMarcacoesMobile,
} from '../services/pontoMobileService.js';
import { auditar } from '../services/auditService.js';

export default async function mobileRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  function requireAdmin(request, reply) {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ error: 'Acesso negado' });
      return false;
    }
    if (!isMobileConfigured()) {
      reply.code(422).send({ error: 'Integração mobile não configurada no servidor.' });
      return false;
    }
    return true;
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  fastify.get('/mobile/status', async () => {
    return successResponse({ configurado: isMobileConfigured() });
  });

  // ── Listar filiais com status mobile ────────────────────────────────────────

  fastify.get('/mobile/filiais', async (request) => {
    const filiais = await EmpresaRepository.findFiliaisByEmpresa(request.empresaId);
    return successResponse(filiais);
  });

  // ── Sincronizar filial ───────────────────────────────────────────────────────

  fastify.post('/mobile/sync/filial/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    const mobileId = await syncFilial(id);
    return successResponse({ filial_id: id, pontomobile_id: mobileId }, 'Filial sincronizada com sucesso.');
  });

  // ── Sincronizar funcionário individual ──────────────────────────────────────

  fastify.post('/mobile/sync/funcionario/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    const mobileId = await syncFuncionario(id);
    return successResponse(
      { funcionario_id: id, pontomobile_id: mobileId },
      'Funcionário sincronizado com sucesso.',
    );
  });

  // ── Sincronizar todos os funcionários (com filtro opcional de filial) ────────

  fastify.post(
    '/mobile/sync/funcionarios',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            filial_id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const filialId = request.body?.filial_id ?? null;
      const result = await syncAllFuncionarios(request.empresaId, filialId);
      const msg = `Sincronização concluída: ${result.sincronizados} funcionário(s).`;
      return successResponse(result, msg);
    },
  );

  // ── Importar marcações ───────────────────────────────────────────────────────

  fastify.post(
    '/mobile/pull-marcacoes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['filial_id', 'data_inicio', 'data_fim'],
          properties: {
            filial_id: { type: 'integer', minimum: 1 },
            data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            data_fim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            lotacao_id: { type: 'integer', minimum: 1 },
            funcionario_id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { filial_id, data_inicio, data_fim, lotacao_id, funcionario_id } = request.body;
      const result = await pullMarcacoes(filial_id, data_inicio, data_fim, lotacao_id ?? null, funcionario_id ?? null);
      const msg = `Importação concluída: ${result.importados} novas, ${result.ignorados} ignoradas, ${result.bloqueados} em dias bloqueados, ${result.duplicatas_bloqueadas} bloqueadas por duplicação.`;
      return successResponse(result, msg);
    },
  );

  // ── Listar batidas bloqueadas por duplicação ────────────────────────────────

  fastify.get(
    '/mobile/bloqueadas',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            funcionario_id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const funcionarioId = request.query.funcionario_id ?? null;
      const bloqueadas = await listarBloqueadas(request.empresaId, funcionarioId);
      return successResponse(bloqueadas);
    },
  );

  // ── Aprovação de batidas do app mobile ───────────────────────────────────────

  fastify.get(
    '/mobile/aprovacao/pendentes',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['filial_id', 'data_inicio', 'data_fim'],
          properties: {
            filial_id: { type: 'integer', minimum: 1 },
            data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            data_fim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            lotacao_id: { type: 'integer', minimum: 1 },
            funcionario_id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { filial_id, data_inicio, data_fim, lotacao_id, funcionario_id } = request.query;
      try {
        const pendentes = await listarPendentesAprovacao(filial_id, data_inicio, data_fim, lotacao_id ?? null, funcionario_id ?? null);
        return successResponse(pendentes);
      } catch (e) {
        return reply.code(400).send({ error: 'Erro ao buscar pendentes', message: e.message });
      }
    },
  );

  fastify.post(
    '/mobile/aprovacao/decidir',
    {
      schema: {
        body: {
          type: 'object',
          required: ['itens', 'status'],
          properties: {
            status: { type: 'string', enum: ['C', 'N'] },
            itens: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['mobile_id', 'funcionario_id', 'data_hora_utc'],
                properties: {
                  mobile_id: { type: 'integer', minimum: 1 },
                  funcionario_id: { type: 'integer', minimum: 1 },
                  data_hora_utc: { type: 'string' },
                  observacao: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { itens, status } = request.body;
      let resultado;
      try {
        resultado = await decidirMarcacoesMobile({
          itens,
          status,
          adminFuncionarioId: request.user.id,
          empresaId: request.empresaId,
        });
      } catch (e) {
        return reply.code(400).send({ error: 'Erro ao decidir', message: e.message });
      }
      auditar({
        acao: 'UPDATE',
        tabela: 'marcacoes_mobile_aprovacao',
        registro_id: `${status}-${itens.length}`,
        dados_anteriores: null,
        dados_novos: resultado,
        usuario_id: request.user.id,
        empresa_id: request.empresaId,
        ip: request.ip,
      });
      const msg = status === 'C'
        ? `${resultado.processados} batida(s) aprovada(s)`
        : `${resultado.processados} batida(s) negada(s)`;
      return successResponse(resultado, msg);
    },
  );

  // ── Desbloquear uma batida ───────────────────────────────────────────────────

  fastify.post(
    '/mobile/bloqueadas/:id/desbloquear',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const id = parseInt(request.params.id, 10);
      const result = await desbloquearBloqueada(id, request.user.id);
      return successResponse(result, 'Batida desbloqueada e adicionada aos registros.');
    },
  );
}
