import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import {
  gerarDias,
  salvarEscala,
  buscarPorPeriodo,
  listarFuncionariosComEscala,
} from '../services/escalaService.js';
import { query } from '../config/database.js';
import { auditar } from '../services/auditService.js';

const gerarSchema = {
  body: {
    type: 'object',
    required: ['funcionario_id', 'data_inicio', 'data_fim', 'tipo_ciclo', 'inicio_ciclo'],
    properties: {
      funcionario_id: { type: 'integer' },
      data_inicio:    { type: 'string', format: 'date' },
      data_fim:       { type: 'string', format: 'date' },
      tipo_ciclo:     { type: 'string', enum: ['1x5', '1x6', '12x36', '24x72', '12x24x12x36'] },
      inicio_ciclo:   { type: 'string', format: 'date' },
      entrada1: { type: 'string' },
      saida1:   { type: 'string' },
      entrada2: { type: 'string' },
      saida2:   { type: 'string' },
      entrada3: { type: 'string' },
      saida3:   { type: 'string' },
      entrada4: { type: 'string' },
      saida4:   { type: 'string' },
      fim_noturno: { type: 'string' },
    },
  },
};

export default async function escalasRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ─── GET /escalas/funcionarios ─── lista quem tem usa_escala=1
  fastify.get('/escalas/funcionarios', {
    preHandler: [authorize('admin', 'gestor')],
  }, async (request) => {
    const filialId = request.user.role === 'admin'
      ? (request.query.filial_id ? Number(request.query.filial_id) : null)
      : (request.user.filial_id ?? null);

    const lista = await listarFuncionariosComEscala(request.empresaId, filialId);
    return { success: true, data: lista };
  });

  // ─── GET /escalas?funcionario_id=&inicio=&fim= ────────────────────
  fastify.get('/escalas', {
    preHandler: [authorize('admin', 'gestor')],
  }, async (request, reply) => {
    const { funcionario_id, inicio, fim } = request.query;
    if (!funcionario_id || !inicio || !fim) {
      return reply.code(400).send({ error: 'Informe funcionario_id, inicio e fim' });
    }

    // Verifica que funcionário pertence à empresa
    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const dias = await buscarPorPeriodo(funcionario_id, inicio, fim);
    return { success: true, data: dias };
  });

  // ─── POST /escalas/preview ────────────────────────────────────────
  fastify.post('/escalas/preview', {
    preHandler: [authorize('admin', 'gestor')],
    schema: gerarSchema,
  }, async (request, reply) => {
    const { funcionario_id, data_inicio, data_fim, tipo_ciclo, inicio_ciclo,
            entrada1, saida1, entrada2, saida2,
            entrada3, saida3, entrada4, saida4, fim_noturno } = request.body;

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const dias = gerarDias({
      dataInicio: data_inicio, dataFim: data_fim,
      tipoCiclo: tipo_ciclo, inicioCiclo: inicio_ciclo,
      entrada1, saida1, entrada2, saida2,
      entrada3, saida3, entrada4, saida4,
      fimNoturno: fim_noturno,
    });

    return { success: true, data: dias };
  });

  // ─── POST /escalas ────────────────────────────────────────────────
  fastify.post('/escalas', {
    preHandler: [authorize('admin', 'gestor')],
    schema: gerarSchema,
  }, async (request, reply) => {
    const { funcionario_id, data_inicio, data_fim, tipo_ciclo, inicio_ciclo,
            entrada1, saida1, entrada2, saida2,
            entrada3, saida3, entrada4, saida4, fim_noturno } = request.body;

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const escalaAnterior = await query(
      'SELECT * FROM escalas WHERE funcionario_id = ? AND data BETWEEN ? AND ?',
      [funcionario_id, data_inicio, data_fim],
    );

    const dias = gerarDias({
      dataInicio: data_inicio, dataFim: data_fim,
      tipoCiclo: tipo_ciclo, inicioCiclo: inicio_ciclo,
      entrada1, saida1, entrada2, saida2,
      entrada3, saida3, entrada4, saida4,
      fimNoturno: fim_noturno,
    });

    const total = await salvarEscala(funcionario_id, request.user.id, dias, tipo_ciclo, inicio_ciclo);

    auditar({
      acao: 'INSERT',
      tabela: 'escalas',
      registro_id: `${funcionario_id}-${data_inicio}-${data_fim}`,
      dados_anteriores: escalaAnterior.length > 0 ? escalaAnterior : null,
      dados_novos: { tipo_ciclo, inicio_ciclo, dias },
      usuario_id: request.user.id,
      empresa_id: request.empresaId,
      ip: request.ip,
    });

    return reply.code(201).send({ success: true, total, message: `${total} dias gravados` });
  });

  // ─── DELETE /escalas?funcionario_id=&inicio=&fim= ─────────────────
  fastify.delete('/escalas', {
    preHandler: [authorize('admin', 'gestor')],
  }, async (request, reply) => {
    const { funcionario_id, inicio, fim } = request.query;
    if (!funcionario_id || !inicio || !fim) {
      return reply.code(400).send({ error: 'Informe funcionario_id, inicio e fim' });
    }

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const escalaAnterior = await query(
      'SELECT * FROM escalas WHERE funcionario_id = ? AND data BETWEEN ? AND ?',
      [funcionario_id, inicio, fim],
    );

    const result = await query(
      'DELETE FROM escalas WHERE funcionario_id = ? AND data BETWEEN ? AND ?',
      [funcionario_id, inicio, fim]
    );

    if (escalaAnterior.length > 0) {
      auditar({
        acao: 'DELETE',
        tabela: 'escalas',
        registro_id: `${funcionario_id}-${inicio}-${fim}`,
        dados_anteriores: escalaAnterior,
        dados_novos: null,
        usuario_id: request.user.id,
        empresa_id: request.empresaId,
        ip: request.ip,
      });
    }

    return { success: true, total: result.affectedRows };
  });
}
