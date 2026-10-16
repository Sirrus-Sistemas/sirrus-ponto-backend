import { ROLES } from '../config/constants.js';

/**
 * Middleware que verifica se o token JWT é válido.
 * Usa o plugin @fastify/jwt decorado no app.
 */
export async function authenticate(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.code(401).send({
      error: 'Não autorizado',
      message: 'Token inválido ou expirado',
    });
  }

  // Senha definida por outra pessoa (admin/import/padrão do CPF): até o
  // usuário trocar, o token só serve para trocar a senha — sem isso a troca
  // obrigatória seria só um aviso na tela, contornável chamando a API direto.
  if (request.user.trocar_senha && !ROTAS_LIBERADAS_TROCA_SENHA.has(request.routeOptions.url)) {
    return reply.code(403).send({
      error: 'Troca de senha obrigatória',
      code: 'TROCAR_SENHA',
      message: 'Troque sua senha para continuar.',
    });
  }
}

const ROTAS_LIBERADAS_TROCA_SENHA = new Set([
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/funcionarios/me',
]);

/**
 * Factory: retorna middleware que verifica se o usuário tem uma das roles permitidas.
 * @param  {...string} allowedRoles - Roles permitidas (ex: 'admin', 'gestor')
 */
export function authorize(...allowedRoles) {
  return async (request, reply) => {
    // authenticate deve rodar antes
    const { role } = request.user;

    if (!allowedRoles.includes(role)) {
      reply.code(403).send({
        error: 'Acesso negado',
        message: `Requer perfil: ${allowedRoles.join(' ou ')}`,
      });
    }
  };
}

/**
 * Middleware que garante que o usuário só acessa dados da própria empresa.
 * O empresa_id vem do token JWT. Também expõe filial_id quando presente.
 */
export async function empresaScope(request, reply) {
  const { empresa_id, filial_id } = request.user;

  if (!empresa_id) {
    return reply.code(403).send({
      error: 'Acesso negado',
      message: 'Usuário sem empresa vinculada',
    });
  }

  request.empresaId = empresa_id;
  request.filialId = filial_id ?? null;
}

/**
 * Middleware que restringe o acesso ao escopo da filial do usuário.
 * Admin não é restringido (pode ver todas as filiais da empresa).
 * Gestor e funcionário só veem dados da própria filial.
 */
export async function filialScope(request, reply) {
  const { role, filial_id } = request.user;

  if (role !== 'admin' && !filial_id) {
    return reply.code(403).send({
      error: 'Acesso negado',
      message: 'Usuário sem filial vinculada',
    });
  }

  // Admin pode passar ?filial_id= como query param para filtrar; caso contrário vê tudo
  if (role === 'admin') {
    request.filialId = request.query?.filial_id ? Number(request.query.filial_id) : null;
  } else {
    request.filialId = filial_id;
  }
}
