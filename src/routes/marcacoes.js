import { authenticate, empresaScope } from '../middlewares/auth.js';
import { MarcacaoRepository } from '../repositories/marcacaoRepository.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';
import { EspelhoPontoService, fusoHorarioToTzOffset } from '../services/espelhoPontoService.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
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

    const [func, empresa] = await Promise.all([
      FuncionarioRepository.findById(funcionarioId),
      EmpresaRepository.findById(request.empresaId),
    ]);
    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Funcionário não encontrado' });
    }

    const tzOffset = fusoHorarioToTzOffset(func.fuso_horario ?? empresa?.municipio_fuso_horario);

    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-31`;

    const [rows, diasBloq] = await Promise.all([
      MarcacaoRepository.findByFuncionarioMonth(funcionarioId, ano, mes, tzOffset),
      query(
        `SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data
           FROM marcacoes_dia_bloqueado
          WHERE funcionario_id = ? AND data BETWEEN ? AND ?`,
        [funcionarioId, dataInicio, dataFim],
      ),
    ]);

    const bloqueadoSet = new Set(diasBloq.map((d) => d.data));

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

    const dias = Array.from(diasMap.entries()).map(([data, marcacoes]) => ({
      data,
      bloqueado: bloqueadoSet.has(data),
      marcacoes,
    }));
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

    // Rejeita se já existe batida do mesmo funcionário dentro de 60 segundos
    const [proxima] = await query(
      `SELECT id, data_hora FROM marcacoes
        WHERE funcionario_id = ?
          AND ABS(TIMESTAMPDIFF(SECOND, data_hora, ?)) < 60
        LIMIT 1`,
      [funcionario_id, normalized],
    );
    if (proxima) {
      const horaExistente = String(proxima.data_hora).slice(11, 16);
      return reply.code(409).send({
        error: 'Duplicata',
        message: `Já existe uma marcação às ${horaExistente} para este funcionário (menos de 60 segundos de diferença).`,
      });
    }

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
      properties: {
        data_hora:      { type: 'string' },
        motivo:         { type: 'string' },
        justificativa:  { type: 'string', maxLength: 500 },
        slot_override:  { type: 'integer', minimum: 0, maximum: 7, nullable: true },
        dia_referencia: { type: ['string', 'null'] },
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

    const { data_hora, motivo, justificativa, slot_override, dia_referencia } = request.body;
    const normalized = data_hora ? data_hora.replace('T', ' ').replace('Z', '').slice(0, 19) : undefined;

    await MarcacaoRepository.update(id, {
      dataHora: normalized,
      motivo: justificativa || motivo || null,
      editadoPor: request.user.id,
      slotOverride: slot_override !== undefined ? slot_override : undefined,
      diaReferencia: dia_referencia !== undefined ? dia_referencia : undefined,
    });
    auditar({ acao: 'UPDATE', tabela: 'marcacoes', registro_id: id, dados_anteriores: { data_hora: marcacao.data_hora }, dados_novos: { data_hora: normalized, motivo: justificativa || motivo || null, dia_referencia }, usuario_id: request.user.id, ip: request.ip });
    return successResponse({ id }, 'Batida atualizada');
  });

  // ── Bloqueio de dia ─────────────────────────────────────────────────────────

  const bloquearSchema = {
    body: {
      type: 'object',
      required: ['funcionario_id', 'data'],
      properties: {
        funcionario_id: { type: 'integer', minimum: 1 },
        data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
  };

  fastify.post('/marcacoes/bloquear-dia', { schema: bloquearSchema }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para bloquear dias' });
    }

    const { funcionario_id, data } = request.body;

    const [func] = await query('SELECT empresa_id FROM funcionarios WHERE id = ? LIMIT 1', [funcionario_id]);
    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Não encontrado', message: 'Funcionário não encontrado' });
    }

    await query(
      `INSERT INTO marcacoes_dia_bloqueado (empresa_id, funcionario_id, data, bloqueado_por)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bloqueado_por = VALUES(bloqueado_por), bloqueado_at = CURRENT_TIMESTAMP`,
      [request.empresaId, funcionario_id, data, request.user.id],
    );

    auditar({ acao: 'INSERT', tabela: 'marcacoes_dia_bloqueado', registro_id: `${funcionario_id}-${data}`, dados_anteriores: null, dados_novos: { funcionario_id, data }, usuario_id: request.user.id, ip: request.ip });
    return reply.code(201).send(successResponse({ funcionario_id, data, bloqueado: true }, 'Dia bloqueado'));
  });

  fastify.delete('/marcacoes/bloquear-dia/:funcionario_id/:data', {
    schema: {
      params: {
        type: 'object',
        required: ['funcionario_id', 'data'],
        properties: {
          funcionario_id: { type: 'string', pattern: '^[0-9]+$' },
          data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  }, async (request, reply) => {
    if (request.user.role !== 'admin' && request.user.role !== 'gestor') {
      return reply.code(403).send({ error: 'Acesso negado', message: 'Sem permissão para desbloquear dias' });
    }

    const funcionario_id = parseInt(request.params.funcionario_id, 10);
    const { data } = request.params;

    await query(
      'DELETE FROM marcacoes_dia_bloqueado WHERE funcionario_id = ? AND data = ?',
      [funcionario_id, data],
    );

    auditar({ acao: 'DELETE', tabela: 'marcacoes_dia_bloqueado', registro_id: `${funcionario_id}-${data}`, dados_anteriores: { funcionario_id, data }, dados_novos: null, usuario_id: request.user.id, ip: request.ip });
    return successResponse({ funcionario_id, data, bloqueado: false }, 'Dia desbloqueado');
  });

  const diasBloqueadosQuerySchema = {
    querystring: {
      type: 'object',
      required: ['funcionario_id', 'data_inicio', 'data_fim'],
      properties: {
        funcionario_id: { type: 'string', pattern: '^[0-9]+$' },
        data_inicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        data_fim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
  };

  fastify.get('/marcacoes/dias-bloqueados', { schema: diasBloqueadosQuerySchema }, async (request) => {
    const funcionario_id = parseInt(request.query.funcionario_id, 10);
    const { data_inicio, data_fim } = request.query;

    if (request.user.role !== 'admin' && request.user.role !== 'gestor' && request.user.id !== funcionario_id) {
      return { success: true, data: [] };
    }

    const rows = await query(
      `SELECT DATE_FORMAT(data, '%Y-%m-%d') AS data
         FROM marcacoes_dia_bloqueado
        WHERE funcionario_id = ? AND data BETWEEN ? AND ?
        ORDER BY data ASC`,
      [funcionario_id, data_inicio, data_fim],
    );

    return successResponse(rows.map((r) => r.data));
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
