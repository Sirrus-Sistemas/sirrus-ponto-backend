import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { AuditRepository } from '../repositories/auditRepository.js';
import { parsePagination, paginatedResponse } from '../utils/helpers.js';

const TABELAS_VALIDAS = ['marcacoes', 'marcacoes_dia_bloqueado', 'escalas', 'ocorrencias', 'funcionarios', 'marcacoes_mobile_aprovacao'];

const listarSchema = {
  querystring: {
    type: 'object',
    required: ['data_inicio', 'data_fim'],
    properties: {
      data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      data_fim:    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      tabela:      { type: 'string', enum: TABELAS_VALIDAS },
      acao:        { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
      usuario_id:  { type: 'string', pattern: '^[0-9]+$' },
      page:        { type: 'string', pattern: '^[0-9]+$' },
      limit:       { type: 'string', pattern: '^[0-9]+$' },
    },
  },
};

function parseJsonSafe(str) {
  if (str == null) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export default async function auditoriaRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  fastify.get('/auditoria', {
    preHandler: [authorize('admin')],
    schema: listarSchema,
  }, async (request) => {
    const { page, limit, offset } = parsePagination(request.query);
    const { data_inicio, data_fim, tabela, acao, usuario_id } = request.query;

    const filtros = {
      dataInicio: data_inicio,
      dataFim: data_fim,
      tabela: tabela || null,
      acao: acao || null,
      usuarioId: usuario_id ? Number(usuario_id) : null,
      limit,
      offset,
    };

    const [rows, total] = await Promise.all([
      AuditRepository.listar(request.empresaId, filtros),
      AuditRepository.contar(request.empresaId, filtros),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      usuario_id: r.usuario_id,
      usuario_nome: r.usuario_nome ?? 'Sistema',
      acao: r.acao,
      tabela: r.tabela,
      registro_id: r.registro_id,
      dados_anteriores: parseJsonSafe(r.dados_anteriores),
      dados_novos: parseJsonSafe(r.dados_novos),
      ip_address: r.ip_address,
      created_at: r.created_at,
    }));

    return paginatedResponse(data, total, page, limit);
  });
}
