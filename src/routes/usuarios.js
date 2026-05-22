import bcrypt from 'bcryptjs';
import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { query } from '../config/database.js';
import { successResponse } from '../utils/helpers.js';

export default async function usuariosRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // Lista funcionários com status de acesso ao sistema
  fastify.get('/usuarios', {
    preHandler: [authorize('admin')],
  }, async (request) => {
    const rows = await query(
      `SELECT f.id, f.nome, f.email, f.role, f.ativo AS funcionario_ativo,
              u.cpf, u.ativo AS usuario_ativo,
              CASE WHEN u.funcionario_id IS NOT NULL THEN 1 ELSE 0 END AS tem_acesso
       FROM funcionarios f
       LEFT JOIN usuarios u ON u.funcionario_id = f.id
       WHERE f.empresa_id = ?
       ORDER BY f.nome`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  // Conceder acesso a um funcionário
  fastify.post('/usuarios/:funcionarioId', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['cpf', 'senha', 'role'],
        properties: {
          cpf:   { type: 'string', minLength: 11, maxLength: 11, pattern: '^[0-9]{11}$' },
          senha: { type: 'string', minLength: 6 },
          role:  { type: 'string', enum: ['admin', 'gestor', 'funcionario'] },
        },
      },
    },
  }, async (request, reply) => {
    const funcionarioId = parseInt(request.params.funcionarioId, 10);
    const { cpf, senha, role } = request.body;

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionarioId, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    const [existing] = await query(
      'SELECT funcionario_id FROM usuarios WHERE funcionario_id = ?',
      [funcionarioId]
    );
    if (existing) return reply.code(409).send({ error: 'Este funcionário já possui acesso ao sistema' });

    const [cpfExists] = await query('SELECT cpf FROM usuarios WHERE cpf = ?', [cpf]);
    if (cpfExists) return reply.code(409).send({ error: 'Este CPF já está cadastrado para outro usuário' });

    const senhaHash = await bcrypt.hash(senha, 10);
    await query(
      'INSERT INTO usuarios (funcionario_id, cpf, senha_hash) VALUES (?, ?, ?)',
      [funcionarioId, cpf, senhaHash]
    );
    await query('UPDATE funcionarios SET role = ? WHERE id = ?', [role, funcionarioId]);

    return reply.code(201).send(successResponse(null, 'Acesso criado com sucesso'));
  });

  // Atualizar acesso: role, senha, CPF, ativo
  fastify.put('/usuarios/:funcionarioId', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        properties: {
          role:       { type: 'string', enum: ['admin', 'gestor', 'funcionario'] },
          nova_senha: { type: 'string', minLength: 6 },
          cpf:        { type: 'string', minLength: 11, maxLength: 11, pattern: '^[0-9]{11}$' },
          ativo:      { type: 'integer', minimum: 0, maximum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const funcionarioId = parseInt(request.params.funcionarioId, 10);
    const { role, nova_senha, ativo, cpf } = request.body;

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionarioId, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    if (role) {
      await query('UPDATE funcionarios SET role = ? WHERE id = ?', [role, funcionarioId]);
    }

    const usuarioFields = [];
    const usuarioValues = [];

    if (nova_senha) {
      usuarioFields.push('senha_hash = ?');
      usuarioValues.push(await bcrypt.hash(nova_senha, 10));
    }
    if (ativo !== undefined) {
      usuarioFields.push('ativo = ?');
      usuarioValues.push(ativo);
    }
    if (cpf) {
      const [cpfExists] = await query(
        'SELECT cpf FROM usuarios WHERE cpf = ? AND funcionario_id != ?',
        [cpf, funcionarioId]
      );
      if (cpfExists) return reply.code(409).send({ error: 'Este CPF já está cadastrado para outro usuário' });
      usuarioFields.push('cpf = ?');
      usuarioValues.push(cpf);
    }

    if (usuarioFields.length) {
      usuarioValues.push(funcionarioId);
      await query(
        `UPDATE usuarios SET ${usuarioFields.join(', ')} WHERE funcionario_id = ?`,
        usuarioValues
      );
    }

    return successResponse(null, 'Acesso atualizado');
  });

  // Revogar acesso (desativar usuário)
  fastify.delete('/usuarios/:funcionarioId', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const funcionarioId = parseInt(request.params.funcionarioId, 10);

    const [func] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND empresa_id = ?',
      [funcionarioId, request.empresaId]
    );
    if (!func) return reply.code(404).send({ error: 'Funcionário não encontrado' });

    await query('UPDATE usuarios SET ativo = 0 WHERE funcionario_id = ?', [funcionarioId]);
    return successResponse(null, 'Acesso revogado');
  });
}
