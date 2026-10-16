import { authenticate, empresaScope } from '../middlewares/auth.js';
import { successResponse } from '../utils/helpers.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import {
  syncFilial,
  syncFuncionario,
  iniciarSyncAllFuncionarios,
  getSyncJobStatus,
  pullMarcacoes,
  listarBloqueadas,
  desbloquearBloqueada,
  isMobileConfigured,
  listarPendentesAprovacao,
  decidirMarcacoesMobile,
  listarConflitosPontomobileId,
  redefinirSenhaMobile,
  importarCercasDoMobile,
} from '../services/pontoMobileService.js';
import { auditar } from '../services/auditService.js';
import { motivoSenhaFraca } from '../services/authService.js';
import { query } from '../config/database.js';

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

  // ── Conflitos de pontomobile_id (dois funcionários com a mesma chave no mobile) ──

  fastify.get('/mobile/conflitos-pontomobile-id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const conflitos = await listarConflitosPontomobileId(request.empresaId);
    return successResponse(conflitos);
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

  // ── Importar cercas eletrônicas que já existem no app ───────────────────────

  fastify.post('/mobile/cercas/importar', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const r = await importarCercasDoMobile(request.empresaId);
    auditar({
      acao: 'INSERT',
      tabela: 'cerca_locais',
      registro_id: `importacao-mobile-${request.empresaId}`,
      dados_anteriores: null,
      dados_novos: r,
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });
    return successResponse(
      r,
      `${r.importados} cerca(s) importada(s). ${r.ja_configurados} já configurada(s) aqui (mantidas), `
        + `${r.sem_cerca} sem cerca no app${r.nao_encontrados ? `, ${r.nao_encontrados} não vinculada(s) a funcionário daqui` : ''}.`,
    );
  });

  // ── Redefinir a senha do funcionário no app Ponto Mobile ────────────────────
  // A sincronização normal não mexe mais na senha do app (ver syncFuncionario);
  // esta é a forma de o admin trocar a senha de quem esqueceu.

  fastify.post('/mobile/funcionarios/:id/senha', {
    schema: {
      body: {
        type: 'object',
        required: ['senha'],
        properties: { senha: { type: 'string', minLength: 6, maxLength: 100 } },
      },
    },
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = parseInt(request.params.id, 10);
    const [func] = await query('SELECT id, cpf, empresa_id FROM funcionarios WHERE id = ? LIMIT 1', [id]);
    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Funcionário não encontrado' });
    }
    const motivo = motivoSenhaFraca(request.body.senha, func.cpf);
    if (motivo) return reply.code(422).send({ error: motivo, message: motivo });

    const aplicada = await redefinirSenhaMobile(id, request.body.senha);
    auditar({
      acao: 'UPDATE',
      tabela: 'funcionarios',
      registro_id: id,
      dados_anteriores: null,
      dados_novos: { senha_mobile: '(redefinida)' },
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });
    return successResponse(
      { aplicada },
      aplicada
        ? 'Senha do Ponto Mobile redefinida.'
        : 'Senha salva — será usada quando o funcionário for sincronizado com o Ponto Mobile.',
    );
  });

  // ── Sincronizar todos os funcionários (filtros opcionais de filial e lotação) ─

  fastify.post(
    '/mobile/sync/funcionarios',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            filial_id: { type: 'integer', minimum: 1 },
            lotacao_id: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { jobId, jaEmAndamento } = iniciarSyncAllFuncionarios(request.empresaId, {
        filialId: request.body?.filial_id ?? null,
        lotacaoId: request.body?.lotacao_id ?? null,
      });
      return successResponse(
        { job_id: jobId },
        jaEmAndamento
          ? 'Já existe uma sincronização em andamento para esta empresa.'
          : 'Sincronização iniciada em segundo plano.',
      );
    },
  );

  // ── Status da sincronização em lote (polling) ────────────────────────────────

  fastify.get('/mobile/sync/funcionarios/:jobId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const job = getSyncJobStatus(request.params.jobId, request.empresaId);
    if (!job) {
      reply.code(404).send({ error: 'Sincronização não encontrada ou expirada.' });
      return;
    }
    return successResponse({
      status: job.status,
      total: job.total,
      processados: job.processados,
      sincronizados: job.sincronizados,
      erros: job.erros,
      sucessos: job.sucessos,
      erro_geral: job.erroGeral,
    });
  });

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
