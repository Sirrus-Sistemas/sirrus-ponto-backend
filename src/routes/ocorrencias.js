import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { query } from '../config/database.js';
import { successResponse } from '../utils/helpers.js';

export default async function ocorrenciasRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE OCORRÊNCIA
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/tipos-ocorrencia', async (request) => {
    const rows = await query(
      `SELECT id, descricao, tipo_lancamento, ativo
         FROM tipos_ocorrencia
        WHERE empresa_id = ?
        ORDER BY descricao`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  fastify.post('/tipos-ocorrencia', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['descricao', 'tipo_lancamento'],
        properties: {
          descricao:       { type: 'string', minLength: 2, maxLength: 100 },
          tipo_lancamento: { type: 'string', enum: ['credito', 'debito'] },
        },
      },
    },
  }, async (request, reply) => {
    const { descricao, tipo_lancamento } = request.body;
    const result = await query(
      'INSERT INTO tipos_ocorrencia (empresa_id, descricao, tipo_lancamento) VALUES (?, ?, ?)',
      [request.empresaId, descricao.trim(), tipo_lancamento]
    );
    return reply.code(201).send(successResponse(
      { id: result.insertId, descricao: descricao.trim(), tipo_lancamento, ativo: 1 },
      'Tipo de ocorrência cadastrado'
    ));
  });

  fastify.put('/tipos-ocorrencia/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const { descricao, tipo_lancamento, ativo } = request.body ?? {};
    const fields = [];
    const values = [];
    if (descricao !== undefined) { fields.push('descricao = ?'); values.push(descricao.trim()); }
    if (tipo_lancamento !== undefined) { fields.push('tipo_lancamento = ?'); values.push(tipo_lancamento); }
    if (ativo !== undefined) { fields.push('ativo = ?'); values.push(ativo); }
    if (fields.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    values.push(request.params.id, request.empresaId);
    await query(
      `UPDATE tipos_ocorrencia SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`,
      values
    );
    return successResponse(null, 'Tipo de ocorrência atualizado');
  });

  // ═══════════════════════════════════════════════════════════════════
  // OCORRÊNCIAS (lançamentos)
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/ocorrencias', async (request) => {
    const { funcionario_id, ano, mes } = request.query;

    let sql = `
      SELECT o.id, o.funcionario_id,
             DATE_FORMAT(o.data_inicio, '%Y-%m-%d') AS data_inicio,
             DATE_FORMAT(o.data_fim,    '%Y-%m-%d') AS data_fim,
             o.tipo, o.tipo_ocorrencia_id, o.turno, o.tipo_hora,
             o.quantidade_horas, o.descricao,
             f.nome AS funcionario_nome,
             t.descricao AS tipo_ocorrencia_descricao,
             t.tipo_lancamento
        FROM ocorrencias o
        JOIN funcionarios f ON f.id = o.funcionario_id AND f.empresa_id = ?
        LEFT JOIN tipos_ocorrencia t ON t.id = o.tipo_ocorrencia_id
       WHERE f.empresa_id = ?
    `;
    const params = [request.empresaId, request.empresaId];

    if (funcionario_id) {
      sql += ' AND o.funcionario_id = ?';
      params.push(Number(funcionario_id));
    }

    if (ano && mes) {
      const pad = (n) => String(n).padStart(2, '0');
      const primeiro = `${ano}-${pad(mes)}-01`;
      const diasMes = new Date(Number(ano), Number(mes), 0).getDate();
      const ultimo  = `${ano}-${pad(mes)}-${pad(diasMes)}`;
      sql += ' AND o.data_inicio <= ? AND o.data_fim >= ?';
      params.push(ultimo, primeiro);
    }

    sql += ' ORDER BY o.data_inicio DESC';

    const rows = await query(sql, params);
    return successResponse(rows);
  });

  fastify.post('/ocorrencias', {
    schema: {
      body: {
        type: 'object',
        required: ['funcionario_id', 'data_inicio', 'data_fim', 'tipo_ocorrencia_id', 'turno', 'tipo_hora'],
        properties: {
          funcionario_id:    { type: 'integer' },
          data_inicio:       { type: 'string' },
          data_fim:          { type: 'string' },
          tipo_ocorrencia_id:{ type: 'integer' },
          turno:             { type: 'string', enum: ['integral','1_periodo','2_periodo','3_periodo','4_periodo'] },
          tipo_hora:         { type: 'string', enum: ['hora_50_60','hora_100'] },
          quantidade_horas:  { type: ['number', 'null'] },
          descricao:         { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { funcionario_id, data_inicio, data_fim, tipo_ocorrencia_id,
            turno, tipo_hora, quantidade_horas, descricao } = request.body;

    // Verify funcionario belongs to empresa
    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionario_id, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    // Verify tipo_ocorrencia belongs to empresa
    const [tipo] = await query(
      'SELECT id, tipo_lancamento FROM tipos_ocorrencia WHERE id = ? AND empresa_id = ?',
      [tipo_ocorrencia_id, request.empresaId]
    );
    if (!tipo) return reply.code(404).send({ error: 'Tipo de ocorrência não encontrado' });

    const result = await query(
      `INSERT INTO ocorrencias
         (funcionario_id, data_inicio, data_fim, tipo, tipo_ocorrencia_id,
          turno, tipo_hora, quantidade_horas, descricao, lancado_por)
       VALUES (?, ?, ?, 'outros', ?, ?, ?, ?, ?, ?)`,
      [funcionario_id, data_inicio, data_fim, tipo_ocorrencia_id,
       turno, tipo_hora, quantidade_horas ?? null, descricao?.trim() || null,
       request.user.id]
    );

    return reply.code(201).send(successResponse({ id: result.insertId }, 'Ocorrência lançada'));
  });

  fastify.put('/ocorrencias/:id', async (request, reply) => {
    const { data_inicio, data_fim, tipo_ocorrencia_id, turno, tipo_hora,
            quantidade_horas, descricao } = request.body ?? {};

    // Verify scope via funcionario join
    const [existing] = await query(
      `SELECT o.id FROM ocorrencias o
         JOIN funcionarios f ON f.id = o.funcionario_id AND f.empresa_id = ?
        WHERE o.id = ?`,
      [request.empresaId, request.params.id]
    );
    if (!existing) return reply.code(404).send({ error: 'Ocorrência não encontrada' });

    const fields = [];
    const values = [];
    if (data_inicio !== undefined)        { fields.push('data_inicio = ?');        values.push(data_inicio); }
    if (data_fim !== undefined)           { fields.push('data_fim = ?');           values.push(data_fim); }
    if (tipo_ocorrencia_id !== undefined) { fields.push('tipo_ocorrencia_id = ?'); values.push(tipo_ocorrencia_id); }
    if (turno !== undefined)              { fields.push('turno = ?');              values.push(turno); }
    if (tipo_hora !== undefined)          { fields.push('tipo_hora = ?');          values.push(tipo_hora); }
    if (quantidade_horas !== undefined)   { fields.push('quantidade_horas = ?');   values.push(quantidade_horas); }
    if (descricao !== undefined)          { fields.push('descricao = ?');          values.push(descricao?.trim() || null); }

    if (fields.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    values.push(request.params.id);
    await query(`UPDATE ocorrencias SET ${fields.join(', ')} WHERE id = ?`, values);
    return successResponse(null, 'Ocorrência atualizada');
  });

  fastify.delete('/ocorrencias/:id', async (request, reply) => {
    const [existing] = await query(
      `SELECT o.id FROM ocorrencias o
         JOIN funcionarios f ON f.id = o.funcionario_id AND f.empresa_id = ?
        WHERE o.id = ?`,
      [request.empresaId, request.params.id]
    );
    if (!existing) return reply.code(404).send({ error: 'Ocorrência não encontrada' });
    await query('DELETE FROM ocorrencias WHERE id = ?', [request.params.id]);
    return successResponse(null, 'Ocorrência excluída');
  });
}
