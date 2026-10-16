import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { successResponse } from '../utils/helpers.js';
import { query } from '../config/database.js';
import { auditar } from '../services/auditService.js';
import { ESCOPOS, buscarDono, obterConfiguracao, salvarConfiguracao } from '../services/cercaService.js';
import { isMobileConfigured, syncFuncionario } from '../services/pontoMobileService.js';

const localSchema = {
  type: 'object',
  required: ['latitude', 'longitude', 'raio_metros'],
  properties: {
    descricao: { type: ['string', 'null'], maxLength: 120 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    raio_metros: { type: 'number', minimum: 10, maximum: 100000 },
  },
  additionalProperties: false,
};

/**
 * Reenvia ao Ponto Mobile a cerca dos funcionários afetados por uma mudança
 * de filial/lotação — só quem já está no app (pontomobile_id), para não criar
 * conta no app de quem não usa. Roda em segundo plano; falha só vai pro log.
 */
function ressincronizarEmSegundoPlano(ids, log) {
  const CONCORRENCIA = 5;
  (async () => {
    for (let i = 0; i < ids.length; i += CONCORRENCIA) {
      const lote = ids.slice(i, i + CONCORRENCIA);
      const res = await Promise.allSettled(lote.map((id) => syncFuncionario(id)));
      res.forEach((r, k) => {
        if (r.status === 'rejected') log.warn({ funcionario_id: lote[k], err: r.reason?.message }, 'Cerca: falha ao reenviar ao Ponto Mobile');
      });
    }
  })().catch((err) => log.error({ err }, 'Cerca: ressincronização interrompida'));
}

export default async function cercasRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  function validarEscopo(escopo, reply) {
    if (ESCOPOS.includes(escopo)) return true;
    reply.code(400).send({ error: 'Escopo inválido', message: 'Use filial, lotacao ou funcionario.' });
    return false;
  }

  // ── GET /api/cercas/:escopo/:id ───────────────────────────────────────
  fastify.get('/cercas/:escopo/:id', { preHandler: [authorize('admin')] }, async (request, reply) => {
    const { escopo } = request.params;
    if (!validarEscopo(escopo, reply)) return;
    const config = await obterConfiguracao(escopo, Number(request.params.id), request.empresaId);
    if (!config) return reply.code(404).send({ error: 'Não encontrado' });
    return successResponse(config);
  });

  // ── PUT /api/cercas/:escopo/:id ───────────────────────────────────────
  fastify.put('/cercas/:escopo/:id', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['valida_localizacao', 'locais'],
        properties: {
          valida_localizacao: { type: 'string', enum: ['herdar', 'sim', 'nao'] },
          locais: { type: 'array', maxItems: 50, items: localSchema },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { escopo } = request.params;
    if (!validarEscopo(escopo, reply)) return;
    const id = Number(request.params.id);
    if (escopo === 'filial' && request.body.valida_localizacao === 'herdar') {
      return reply.code(400).send({ error: 'Filial não herda', message: 'Na filial, escolha Sim ou Não.' });
    }
    const dono = await buscarDono(escopo, id, request.empresaId);
    if (!dono) return reply.code(404).send({ error: 'Não encontrado' });

    const anterior = await obterConfiguracao(escopo, id, request.empresaId);
    await salvarConfiguracao(escopo, id, request.empresaId, request.body);
    auditar({
      acao: 'UPDATE',
      tabela: 'cerca_locais',
      registro_id: `${escopo}-${id}`,
      dados_anteriores: { valida_localizacao: anterior.valida_localizacao, locais: anterior.locais },
      dados_novos: request.body,
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    // Leva a mudança para o app. Funcionário: na hora (erro volta na tela).
    // Filial/lotação: todos os afetados que já estão no app, em segundo plano.
    if (!isMobileConfigured()) {
      return successResponse({ enviados: 0 }, 'Cerca salva. Integração com o Ponto Mobile não configurada.');
    }
    if (escopo === 'funcionario') {
      const [f] = await query('SELECT pontomobile_id FROM funcionarios WHERE id = ?', [id]);
      if (!f?.pontomobile_id) {
        return successResponse({ enviados: 0 }, 'Cerca salva. Vai para o Ponto Mobile quando o funcionário for sincronizado.');
      }
      try {
        await syncFuncionario(id);
      } catch (err) {
        return successResponse({ enviados: 0, erro: err.message }, `Cerca salva, mas não foi enviada ao Ponto Mobile: ${err.message}`);
      }
      return successResponse({ enviados: 1 }, 'Cerca salva e enviada ao Ponto Mobile.');
    }

    const coluna = escopo === 'filial' ? 'filial_id' : 'lotacao_id';
    const afetados = await query(
      `SELECT id FROM funcionarios
        WHERE empresa_id = ? AND ${coluna} = ? AND ativo = 1 AND pontomobile_id IS NOT NULL`,
      [request.empresaId, id],
    );
    ressincronizarEmSegundoPlano(afetados.map((f) => f.id), request.log);
    return successResponse(
      { enviados: afetados.length },
      afetados.length
        ? `Cerca salva. Enviando para ${afetados.length} funcionário(s) no Ponto Mobile em segundo plano.`
        : 'Cerca salva.',
    );
  });
}
