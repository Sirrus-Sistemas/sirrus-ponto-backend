import { authenticate, empresaScope } from '../middlewares/auth.js';
import { MarcacaoRepository } from '../repositories/marcacaoRepository.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';
import { EspelhoPontoService, fusoHorarioToTzOffset } from '../services/espelhoPontoService.js';
import { successResponse } from '../utils/helpers.js';
import { toIsoDataHoraUtc } from '../utils/dataHoraIso.js';
import { query } from '../config/database.js';
import { auditar } from '../services/auditService.js';

const espelhoQuerySchema = {
  querystring: {
    type: 'object',
    required: ['ano', 'mes'],
    properties: {
      ano: { type: 'string', pattern: '^[0-9]{4}$' },
      mes: { type: 'string', pattern: '^(0?[1-9]|1[0-2])$' },
      funcionario_id: { type: 'string', pattern: '^[0-9]+$' },
    },
  },
};

const registrarMarcacaoSchema = {
  body: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: ['manual', 'geo', 'rep', 'online'] },
    },
  },
};

export default async function marcacaoRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  fastify.post('/marcacoes', { schema: registrarMarcacaoSchema }, async (request, reply) => {
    const tipo = request.body?.tipo || 'online';
    const row = await MarcacaoRepository.insert({
      funcionarioId: request.user.id,
      tipo,
      deviceInfo: request.headers['user-agent']?.slice(0, 250) || null,
      ipAddress: request.ip || null,
    });

    if (!row) {
      return reply.code(500).send({ error: 'Erro ao registrar', message: 'Não foi possível salvar a marcação' });
    }

    const payload = {
      id: row.id,
      data_hora: toIsoDataHoraUtc(row.data_hora),
      tipo: row.tipo,
    };

    return reply.code(201).send(successResponse(payload, 'Marcação registrada'));
  });

  fastify.get('/marcacoes/espelho', { schema: espelhoQuerySchema }, async (request, reply) => {
    const ano = parseInt(request.query.ano, 10);
    const mes = parseInt(request.query.mes, 10);

    if (ano < 2000 || ano > 2100) {
      return reply.code(400).send({ error: 'Parâmetro inválido', message: 'Ano fora do intervalo permitido' });
    }

    let funcionarioId = request.user.id;
    if (request.query.funcionario_id) {
      if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
        return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para ver espelho de outro funcionário' });
      }
      funcionarioId = parseInt(request.query.funcionario_id, 10);
    }

    const data = await EspelhoPontoService.buildEspelho(funcionarioId, request.empresaId, ano, mes);
    return successResponse(data);
  });

  // ── Ficha de ponto ──────────────────────────────────────────────────

  const fichaQuerySchema = {
    querystring: {
      type: 'object',
      required: ['ano', 'mes'],
      properties: {
        ano: { type: 'string', pattern: '^[0-9]{4}$' },
        mes: { type: 'string', pattern: '^(0?[1-9]|1[0-2])$' },
        funcionario_id: { type: 'string', pattern: '^[0-9]+$' },
      },
    },
  };

  fastify.get('/marcacoes/ficha', { schema: fichaQuerySchema }, async (request, reply) => {
    const ano = parseInt(request.query.ano, 10);
    const mes = parseInt(request.query.mes, 10);

    let funcionarioId = request.user.id;
    if (request.query.funcionario_id) {
      if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
        return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para ver ficha de outro funcionário' });
      }
      funcionarioId = parseInt(request.query.funcionario_id, 10);
    }

    const func = await FuncionarioRepository.findById(funcionarioId);
    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Funcionário não encontrado' });
    }

    const tzOffset = fusoHorarioToTzOffset(func.fuso_horario);
    const rows = await MarcacaoRepository.findByFuncionarioMonth(funcionarioId, ano, mes, tzOffset);

    // Group by day
    const diasMap = new Map();
    for (const r of rows) {
      const dia = r.dia;
      if (!diasMap.has(dia)) diasMap.set(dia, []);
      diasMap.get(dia).push({
        id: r.id,
        data_hora: toIsoDataHoraUtc(r.data_hora),
        tipo: r.tipo,
        motivo_edicao: r.motivo_edicao ?? null,
        original: r.original,
      });
    }

    const dias = Array.from(diasMap.entries()).map(([data, marcacoes]) => ({ data, marcacoes }));
    dias.sort((a, b) => a.data.localeCompare(b.data));

    return successResponse({
      funcionario: { id: func.id, nome: func.nome, matricula: func.matricula ?? null },
      ano,
      mes,
      dias,
    });
  });

  const lancarSchema = {
    body: {
      type: 'object',
      required: ['funcionario_id', 'data_hora'],
      properties: {
        funcionario_id: { type: 'integer' },
        data_hora: { type: 'string' },
        motivo: { type: 'string' },
        justificativa: { type: 'string', maxLength: 500 },
        slot_override: { type: 'integer', minimum: 0, maximum: 7, nullable: true },
      },
    },
  };

  fastify.post('/marcacoes/lancar', { schema: lancarSchema }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para lançar batidas' });
    }

    const { funcionario_id, data_hora, motivo, justificativa, slot_override } = request.body;

    const func = await FuncionarioRepository.findById(funcionario_id);
    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Funcionário não encontrado' });
    }

    // Accept ISO or "YYYY-MM-DD HH:MM" and normalise to MySQL DATETIME
    const normalized = data_hora.replace('T', ' ').replace('Z', '').slice(0, 19);

    const row = await MarcacaoRepository.insertManual({
      funcionarioId: funcionario_id,
      dataHora: normalized,
      motivo: justificativa || motivo || 'ESQUECIMENTO',
      editadoPor: request.user.id,
      slotOverride: slot_override !== undefined ? slot_override : null,
    });

    const responseData = {
      id: row.id,
      data_hora: toIsoDataHoraUtc(row.data_hora),
      tipo: row.tipo,
      motivo_edicao: row.motivo_edicao,
      slot_override: row.slot_override ?? null,
    };
    auditar({ acao: 'INSERT', tabela: 'marcacoes', registro_id: row.id, dados_anteriores: null, dados_novos: responseData, usuario_id: request.user.id, ip: request.ip });
    return reply.code(201).send(successResponse(responseData, 'Batida lançada'));
  });

  const editarSchema = {
    body: {
      type: 'object',
      required: ['data_hora'],
      properties: {
        data_hora: { type: 'string' },
        motivo: { type: 'string' },
        justificativa: { type: 'string', maxLength: 500 },
        slot_override: { type: 'integer', minimum: 0, maximum: 7, nullable: true },
      },
    },
  };

  fastify.put('/marcacoes/:id', { schema: editarSchema }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para editar batidas' });
    }

    const id = parseInt(request.params.id, 10);
    const marcacao = await MarcacaoRepository.findById(id);
    if (!marcacao) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Marcação não encontrada' });
    }

    // Verify empresa scope
    const [funcRows] = await query(
      'SELECT empresa_id FROM funcionarios WHERE id = ? LIMIT 1',
      [marcacao.funcionario_id],
    );
    if (!funcRows || funcRows.empresa_id !== request.empresaId) {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Marcação não pertence à sua empresa' });
    }

    const { data_hora, motivo, justificativa, slot_override } = request.body;
    const normalized = data_hora.replace('T', ' ').replace('Z', '').slice(0, 19);

    await MarcacaoRepository.update(id, {
      dataHora: normalized,
      motivo: justificativa || motivo || null,
      editadoPor: request.user.id,
      slotOverride: slot_override !== undefined ? slot_override : undefined,
    });
    auditar({ acao: 'UPDATE', tabela: 'marcacoes', registro_id: id, dados_anteriores: { data_hora: marcacao.data_hora }, dados_novos: { data_hora: normalized, motivo: justificativa || motivo || null }, usuario_id: request.user.id, ip: request.ip });
    return successResponse({ id }, 'Batida atualizada');
  });

  fastify.delete('/marcacoes/:id', async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para excluir batidas' });
    }

    const id = parseInt(request.params.id, 10);
    const marcacao = await MarcacaoRepository.findById(id);
    if (!marcacao) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Marcação não encontrada' });
    }

    const [funcRows] = await query(
      'SELECT empresa_id FROM funcionarios WHERE id = ? LIMIT 1',
      [marcacao.funcionario_id],
    );
    if (!funcRows || funcRows.empresa_id !== request.empresaId) {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Marcação não pertence à sua empresa' });
    }

    await MarcacaoRepository.deleteById(id);
    auditar({ acao: 'DELETE', tabela: 'marcacoes', registro_id: id, dados_anteriores: { data_hora: marcacao.data_hora, funcionario_id: marcacao.funcionario_id }, dados_novos: null, usuario_id: request.user.id, ip: request.ip });
    return successResponse({ id }, 'Batida excluída');
  });
}
