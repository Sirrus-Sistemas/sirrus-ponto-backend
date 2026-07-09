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
} from '../services/pontoMobileService.js';

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
