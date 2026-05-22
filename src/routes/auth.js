import { AuthService } from '../services/authService.js';
import { authenticate } from '../middlewares/auth.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';
import { checkLicenca } from '../services/licencaService.js';
import crypto from 'crypto';

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

  // ─── POST /auth/forgot-password ───────────────────────────────────
  fastify.post('/auth/forgot-password', { schema: forgotPasswordSchema }, async (request) => {
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
  fastify.post('/auth/login', { schema: loginSchema }, async (request, reply) => {
    const { cpf, password } = request.body;

    const userData = await AuthService.login(cpf, password);

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

    // Gera access token (curta duração)
    const accessToken = fastify.jwt.sign(
      {
        id: userData.id,
        empresa_id: userData.empresa_id,
        filial_id: userData.filial_id ?? null,
        role: userData.role,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    // Gera refresh token (longa duração)
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const days = parseInt(refreshExpiresIn) || 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await AuthService.saveRefreshToken(userData.id, refreshToken, {
      deviceInfo: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt,
    });

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

    // Gera novo par de tokens
    const accessToken = fastify.jwt.sign(
      {
        id: userData.id,
        empresa_id: userData.empresa_id,
        filial_id: userData.filial_id ?? null,
        role: userData.role,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    const days = parseInt(process.env.JWT_REFRESH_EXPIRES_IN) || 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await AuthService.saveRefreshToken(userData.id, newRefreshToken, {
      deviceInfo: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt,
    });

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

  // ─── PUT /auth/change-password ────────────────────────────────────
  fastify.put('/auth/change-password', {
    preHandler: [authenticate],
    schema: changePasswordSchema,
  }, async (request, reply) => {
    const { current_password, new_password } = request.body;
    await AuthService.changePassword(request.user.id, current_password, new_password);
    return { success: true, message: 'Senha alterada com sucesso. Faça login novamente.' };
  });
}
