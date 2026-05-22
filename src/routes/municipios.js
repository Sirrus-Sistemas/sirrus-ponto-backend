import { authenticate, authorize } from '../middlewares/auth.js';
import { query } from '../config/database.js';
import { successResponse } from '../utils/helpers.js';

export default async function municipiosRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/municipios', async (request) => {
    const { search = '', estado = '', page = '1', limit = '20' } = request.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('NOMEMUNICIPIO LIKE ?');
      params.push(`%${search}%`);
    }
    if (estado) {
      conditions.push('ESTADO = ?');
      params.push(estado.toUpperCase());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM municipios ${where}`,
      params
    );

    const rows = await query(
      `SELECT CODMUNICIPIO, NOMEMUNICIPIO, ESTADO, fuso_horario
       FROM municipios ${where}
       ORDER BY ESTADO, NOMEMUNICIPIO
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return successResponse({ rows, total: Number(total), page: pageNum, limit: limitNum });
  });

  fastify.post('/municipios', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['CODMUNICIPIO', 'NOMEMUNICIPIO', 'ESTADO'],
        properties: {
          CODMUNICIPIO:  { type: 'integer' },
          NOMEMUNICIPIO: { type: 'string', minLength: 2 },
          ESTADO:        { type: 'string', minLength: 2, maxLength: 2 },
          fuso_horario:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { CODMUNICIPIO, NOMEMUNICIPIO, ESTADO, fuso_horario } = request.body;
    await query(
      'INSERT INTO municipios (CODMUNICIPIO, NOMEMUNICIPIO, ESTADO, fuso_horario) VALUES (?, ?, ?, ?)',
      [CODMUNICIPIO, NOMEMUNICIPIO.toUpperCase(), ESTADO.toUpperCase(), fuso_horario || 'UTC-03:00']
    );
    return reply.code(201).send(successResponse({ CODMUNICIPIO }, 'Município criado'));
  });

  fastify.put('/municipios/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const { NOMEMUNICIPIO, ESTADO, fuso_horario } = request.body;
    const fields = [];
    const values = [];

    if (NOMEMUNICIPIO !== undefined) { fields.push('NOMEMUNICIPIO = ?'); values.push(NOMEMUNICIPIO.toUpperCase()); }
    if (ESTADO !== undefined)        { fields.push('ESTADO = ?');        values.push(ESTADO.toUpperCase()); }
    if (fuso_horario !== undefined)  { fields.push('fuso_horario = ?');  values.push(fuso_horario); }

    if (!fields.length) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });

    values.push(request.params.id);
    await query(`UPDATE municipios SET ${fields.join(', ')} WHERE CODMUNICIPIO = ?`, values);
    return successResponse(null, 'Município atualizado');
  });
}
