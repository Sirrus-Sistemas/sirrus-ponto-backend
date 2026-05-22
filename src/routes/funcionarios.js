import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';
import { UsuarioRepository } from '../repositories/usuarioRepository.js';
import { AuthService } from '../services/authService.js';
import { onlyCpfDigits } from '../utils/cpf.js';
import { parsePagination, paginatedResponse, successResponse } from '../utils/helpers.js';

const createSchema = {
  body: {
    type: 'object',
    required: ['nome', 'email', 'cpf', 'data_admissao', 'password'],
    properties: {
      nome: { type: 'string', minLength: 3 },
      email: { type: 'string', format: 'email' },
      cpf: { type: 'string', minLength: 11 },
      telefone: { type: 'string' },
      cargo: { type: 'string' },
      matricula: { type: 'string' },
      data_admissao: { type: 'string', format: 'date' },
      pis: { type: 'string' },
      filial_id: { type: 'integer' },
      departamento_id: { type: 'integer' },
      turno_id: { type: 'integer' },
      lotacao_id: { type: 'integer' },
      gestor_id: { type: 'integer' },
      role: { type: 'string', enum: ['admin', 'gestor', 'funcionario'] },
      usa_escala: { type: 'integer', minimum: 0, maximum: 1 },
      usa_mobile: { type: 'integer', minimum: 0, maximum: 1 },
      password: { type: 'string', minLength: 6 },
      cep: { type: 'string' },
      logradouro: { type: 'string' },
      numero: { type: 'string' },
      complemento: { type: 'string' },
      bairro: { type: 'string' },
      cidade: { type: 'string' },
      estado: { type: 'string', maxLength: 2 },
      municipio_id: { type: 'integer' },
    },
  },
};

const updateSchema = {
  body: {
    type: 'object',
    properties: {
      nome: { type: 'string', minLength: 3 },
      email: { type: 'string', format: 'email' },
      cpf: { type: 'string' },
      telefone: { type: ['string', 'null'] },
      cargo: { type: ['string', 'null'] },
      matricula: { type: ['string', 'null'] },
      pis: { type: ['string', 'null'] },
      data_admissao: { type: 'string', format: 'date' },
      filial_id: { type: ['integer', 'null'] },
      departamento_id: { type: ['integer', 'null'] },
      turno_id: { type: ['integer', 'null'] },
      lotacao_id: { type: ['integer', 'null'] },
      gestor_id: { type: ['integer', 'null'] },
      role: { type: 'string', enum: ['admin', 'gestor', 'funcionario'] },
      usa_escala: { type: 'integer', minimum: 0, maximum: 1 },
      usa_mobile: { type: 'integer', minimum: 0, maximum: 1 },
      ativo: { type: 'integer', minimum: 0, maximum: 1 },
      central_ativa: { type: 'integer', minimum: 0, maximum: 1 },
      permitir_geo: { type: 'integer', minimum: 0, maximum: 1 },
      permitir_foto: { type: 'integer', minimum: 0, maximum: 1 },
      permitir_ajuste_ponto: { type: 'integer', minimum: 0, maximum: 1 },
      cep: { type: ['string', 'null'] },
      logradouro: { type: ['string', 'null'] },
      numero: { type: ['string', 'null'] },
      complemento: { type: ['string', 'null'] },
      bairro: { type: ['string', 'null'] },
      cidade: { type: ['string', 'null'] },
      estado: { type: ['string', 'null'], maxLength: 2 },
      municipio_id: { type: ['integer', 'null'] },
    },
  },
};

export default async function funcionarioRoutes(fastify) {
  // Todos os endpoints precisam de autenticação + escopo da empresa
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ─── GET /funcionarios ────────────────────────────────────────────
  fastify.get('/funcionarios', async (request, reply) => {
    const { page, limit, offset } = parsePagination(request.query);
    const { departamento_id, lotacao_id, ativo, search, filial_id } = request.query;

    // Gestor e funcionário só veem a própria filial; admin pode filtrar ou ver tudo
    const filialId = request.user.role === 'admin'
      ? (filial_id ? Number(filial_id) : undefined)
      : (request.user.filial_id ?? undefined);

    const { rows, total } = await FuncionarioRepository.findAll(request.empresaId, {
      filialId,
      departamentoId: departamento_id,
      lotacaoId: lotacao_id ? Number(lotacao_id) : undefined,
      ativo: ativo !== undefined ? parseInt(ativo) : undefined,
      search,
      limit,
      offset,
    });

    return paginatedResponse(rows, total, page, limit);
  });

  // ─── GET /funcionarios/:id ────────────────────────────────────────
  fastify.get('/funcionarios/:id', async (request, reply) => {
    const func = await FuncionarioRepository.findById(request.params.id);

    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Funcionário não encontrado' });
    }

    // Remove campo sensível
    delete func.senha_hash;
    return successResponse(func);
  });

  // ─── POST /funcionarios ───────────────────────────────────────────
  fastify.post('/funcionarios', {
    preHandler: [authorize('admin', 'gestor')],
    schema: createSchema,
  }, async (request, reply) => {
    const { password, ...data } = request.body;

    data.empresa_id = request.empresaId;
    data.senha_hash = await AuthService.hashPassword(password);

    const cpfDigits = onlyCpfDigits(data.cpf);
    if (cpfDigits.length !== 11) {
      return reply.code(400).send({ error: 'CPF inválido', message: 'Informe 11 dígitos do CPF' });
    }
    data.cpf = cpfDigits;

    const id = await FuncionarioRepository.create(data);
    await UsuarioRepository.insertForFuncionario(id, cpfDigits, data.senha_hash);

    const func = await FuncionarioRepository.findById(id);
    delete func.senha_hash;

    return reply.code(201).send(successResponse(func, 'Funcionário criado com sucesso'));
  });

  // ─── PUT /funcionarios/:id ────────────────────────────────────────
  fastify.put('/funcionarios/:id', {
    preHandler: [authorize('admin', 'gestor')],
    schema: updateSchema,
  }, async (request, reply) => {
    const func = await FuncionarioRepository.findById(request.params.id);

    if (!func || func.empresa_id !== request.empresaId) {
      return reply.code(404).send({ error: 'Funcionário não encontrado' });
    }

    await FuncionarioRepository.update(request.params.id, request.body);

    if (request.body.cpf !== undefined) {
      const d = onlyCpfDigits(request.body.cpf);
      if (d.length === 11) {
        await UsuarioRepository.updateCpf(request.params.id, d);
      }
    }

    const updated = await FuncionarioRepository.findById(request.params.id);
    delete updated.senha_hash;

    return successResponse(updated, 'Funcionário atualizado com sucesso');
  });

  // ─── GET /funcionarios/minha-equipe ───────────────────────────────
  fastify.get('/funcionarios/minha-equipe', {
    preHandler: [authorize('gestor')],
  }, async (request, reply) => {
    const equipe = await FuncionarioRepository.findByGestor(
      request.user.id,
      request.empresaId
    );
    return successResponse(equipe);
  });

  // ─── GET /funcionarios/me ─────────────────────────────────────────
  fastify.get('/funcionarios/me', async (request, reply) => {
    const func = await FuncionarioRepository.findById(request.user.id);

    if (!func) {
      return reply.code(404).send({ error: 'Funcionário não encontrado' });
    }

    delete func.senha_hash;
    return successResponse(func);
  });
}
