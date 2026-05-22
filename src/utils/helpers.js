import { PAGINATION } from '../config/constants.js';

/**
 * Extrai e valida parâmetros de paginação da query string.
 */
export function parsePagination(query) {
  let page = parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE;
  let limit = parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT;

  if (page < 1) page = 1;
  if (limit < 1) limit = 1;
  if (limit > PAGINATION.MAX_LIMIT) limit = PAGINATION.MAX_LIMIT;

  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Monta resposta paginada padronizada.
 */
export function paginatedResponse(data, total, page, limit) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * Resposta de sucesso padronizada.
 */
export function successResponse(data, message = 'Operação realizada com sucesso') {
  return { success: true, message, data };
}
