import { AuthService } from '../services/authService.js';
import { authenticate } from '../middlewares/auth.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import { checkLicenca } from '../services/licencaService.js';
import { buscarEmpresas, garantirFuncionarioSuporte } from '../services/suporteService.js';
import { auditar } from '../services/auditService.js';
import crypto from 'crypto';
import { onlyCpfDigits } from '../utils/cpf.js';

// Limite por CPF (não por IP): o global de 500/min deixava testar senhas à
// vontade, e limitar só por IP travaria uma empresa inteira atrás do mesmo NAT.
// Conta toda tentativa, inclusive as certas — 5 em 15 min sobra para quem erra
// a senha de verdade.
const limitePorCpf = {
  rateLimit: {
    max: 5,
    timeWindow: '15 minutes',
    // Padrão é onRequest, antes do body ser lido — sem isso o CPF nunca chega
    // no keyGenerator e tudo cairia na chave do IP.
    hook: 'preHandler',
    keyGenerator: (request) => `cpf:${onlyCpfDigits(request.body?.cpf) || request.ip}`,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Muitas tentativas',
      message: `Muitas tentativas para este CPF. Tente de novo em ${Math.ceil(context.ttl / 60000)} minuto(s).`,
    }),
  },
};

// Schemas de validação (Fastify JSON Schema)
const loginSchema = {
  body: {
    type: 'object',
    required: ['cpf', 'password'],
    properties: {
      cpf: { type: 'string', minLength: 11 },
      password: { type: 'string', minLength: 6 },
    },
  },
};

const refreshSchema = {
  body: {
    type: 'object',
    required: ['refresh_token'],
    properties: {
      refresh_token: { type: 'string' },
    },
  },
};

const changePasswordSchema = {
  body: {
    type: 'object',
    required: ['current_password', 'new_password'],
    properties: {
      current_password: { type: 'string', minLength: 6 },
      new_password: { type: 'string', minLength: 6 },
    },
  },
};

const forgotPasswordSchema = {
  body: {
    type: 'object',
    required: ['cpf'],
    properties: {
      cpf: { type: 'string', minLength: 11 },
    },
  },
};

const resetPasswordSchema = {
  body: {
    type: 'object',
    required: ['token', 'new_password'],
    properties: {
      token: { type: 'string', minLength: 10 },
      new_password: { type: 'string', minLength: 6 },
    },
  },
};

export default async function authRoutes(fastify) {
  async function emitirTokens(request, userData) {
    const accessToken = fastify.jwt.sign(
      {
        id: userData.id,
        empresa_id: userData.empresa_id,
        filial_id: userData.filial_id ?? null,
        role: userData.role,
        // Enquanto true, authenticate só libera trocar a senha (ver middleware).
        ...(userData.trocar_senha ? { trocar_senha: true } : {}),
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const days = parseInt(process.env.JWT_REFRESH_EXPIRES_IN) || 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await AuthService.saveRefreshToken(userData.id, refreshToken, {
      deviceInfo: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  // ─── POST /auth/forgot-password ───────────────────────────────────
  fastify.post('/auth/forgot-password', { schema: forgotPasswordSchema, config: limitePorCpf }, async (request) => {
    const { cpf } = request.body;
    const result = await AuthService.requestPasswordReset(cpf);

    if (result.resetLink && process.env.NODE_ENV === 'development') {
      request.log.info(
        { link: result.resetLink },
        'Recuperação de senha: link (somente em desenvolvimento; configure envio de e-mail em produção)'
      );
    }

    return {
      success: true,
      data: {
        message:
          'Se o CPF estiver cadastrado, você receberá as instruções em breve.',
      },
    };
  });

  // ─── POST /auth/reset-password ────────────────────────────────────
  fastify.post('/auth/reset-password', { schema: resetPasswordSchema }, async (request) => {
    const { token, new_password } = request.body;
    await AuthService.resetPasswordWithToken(token, new_password);
    return {
      success: true,
      data: {
        message: 'Senha redefinida com sucesso. Faça login com a nova senha.',
      },
    };
  });

  // ─── POST /auth/login ─────────────────────────────────────────────
  fastify.post('/auth/login', { schema: loginSchema, config: limitePorCpf }, async (request, reply) => {
    const { cpf, password } = request.body;

    const userData = await AuthService.login(cpf, password);

    // Técnico do suporte Sirrus: ainda sem empresa. Devolve um token curto que
    // só serve para escolher a empresa (ver /auth/suporte/*). A escolha emite
    // o token normal, já com a empresa.
    if (userData.suporte) {
      const suporteToken = fastify.jwt.sign(
        { suporte: true, cpf: userData.cpf },
        { expiresIn: '15m' },
      );
      return {
        success: true,
        data: { suporte: true, suporte_token: suporteToken },
      };
    }

    // Valida licença no banco remoto de liberações
    // Filial própria → valida pelo CNPJ da filial; sem filial → valida pelo CNPJ da empresa
    let cnpjLicenca;
    if (userData.filial_id) {
      const filial = await EmpresaRepository.findFilialById(userData.filial_id);
      cnpjLicenca = filial?.cnpj;
    } else {
      const empresa = await EmpresaRepository.findById(userData.empresa_id);
      cnpjLicenca = empresa?.cnpj;
    }
    await checkLicenca(cnpjLicenca, request.log);

    const { accessToken, refreshToken } = await emitirTokens(request, userData);

    return {
      success: true,
      data: {
        user: {
          id: userData.id,
          nome: userData.nome,
          email: userData.email,
          role: userData.role,
          departamento: userData.departamento_nome,
          turno: userData.turno_nome,
          filial_id: userData.filial_id ?? null,
          filial: userData.filial_nome ?? null,
          trocar_senha: userData.trocar_senha,
        },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: process.env.JWT_EXPIRES_IN || '15m',
      },
    };
  });

  // ─── POST /auth/refresh ───────────────────────────────────────────
  fastify.post('/auth/refresh', { schema: refreshSchema }, async (request, reply) => {
    const { refresh_token } = request.body;

    const userData = await AuthService.verifyRefreshToken(refresh_token);

    const { accessToken, refreshToken: newRefreshToken } = await emitirTokens(request, userData);

    return {
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_in: process.env.JWT_EXPIRES_IN || '15m',
      },
    };
  });

  // ─── POST /auth/logout ────────────────────────────────────────────
  fastify.post('/auth/logout', { preHandler: [authenticate] }, async (request, reply) => {
    await AuthService.revokeAllTokens(request.user.id);
    return { success: true, message: 'Logout realizado com sucesso' };
  });

  // ─── Suporte Sirrus: escolher a empresa ───────────────────────────
  // Protegidas pelo suporte_token (emitido no login por senha diária). Só o
  // técnico autenticado pode listar e entrar em uma empresa.
  async function exigirSuporte(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: 'Sessão de suporte inválida ou expirada.' });
    }
    if (!request.user?.suporte) {
      return reply.code(403).send({ message: 'Acesso restrito ao suporte Sirrus.' });
    }
  }

  // GET /auth/suporte/empresas?busca=
  fastify.get('/auth/suporte/empresas', { preHandler: [exigirSuporte] }, async (request) => {
    const empresas = await buscarEmpresas(request.query?.busca);
    return { success: true, data: empresas };
  });

  // POST /auth/suporte/entrar  { empresa_id }
  fastify.post('/auth/suporte/entrar', {
    preHandler: [exigirSuporte],
    schema: { body: { type: 'object', required: ['empresa_id'], properties: { empresa_id: { type: 'integer', minimum: 1 } } } },
  }, async (request, reply) => {
    const empresaId = request.body.empresa_id;
    const empresa = await EmpresaRepository.findById(empresaId);
    if (!empresa) return reply.code(404).send({ message: 'Empresa não encontrada.' });
    await checkLicenca(empresa.cnpj, request.log);

    const funcionarioId = await garantirFuncionarioSuporte(empresaId);
    const { accessToken, refreshToken } = await emitirTokens(request, {
      id: funcionarioId,
      empresa_id: empresaId,
      filial_id: null,
      role: 'admin',
    });

    // Registra a entrada do técnico na empresa (quem, qual CPF, qual empresa).
    auditar({
      acao: 'SUPORTE_LOGIN',
      tabela: 'empresas',
      registro_id: String(empresaId),
      dados_anteriores: null,
      dados_novos: { cpf_suporte: request.user.cpf, empresa_id: empresaId, razao_social: empresa.razao_social },
      usuario_id: funcionarioId,
      empresa_id: empresaId,
      ip: request.ip,
    });

    return {
      success: true,
      data: {
        user: {
          id: funcionarioId,
          nome: 'Suporte Sirrus',
          role: 'admin',
          suporte: true,
          empresa: empresa.razao_social,
          filial_id: null,
        },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: process.env.JWT_EXPIRES_IN || '15m',
      },
    };
  });

  // ─── PUT /auth/change-password ────────────────────────────────────
  fastify.put('/auth/change-password', {
    preHandler: [authenticate],
    schema: changePasswordSchema,
  }, async (request, reply) => {
    const { current_password, new_password } = request.body;
    await AuthService.changePassword(request.user.id, current_password, new_password);

    // changePassword revoga todas as sessões; esta continua com tokens novos
    // (sem a trava de troca obrigatória) para não obrigar outro login logo
    // depois da troca no primeiro acesso.
    const { accessToken, refreshToken } = await emitirTokens(request, {
      ...request.user,
      trocar_senha: false,
    });
    return {
      success: true,
      message: 'Senha alterada com sucesso.',
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: process.env.JWT_EXPIRES_IN || '15m',
      },
    };
  });
}
