export function errorHandler(error, request, reply) {
  const { statusCode, validation, message } = error;

  // Erros de validação do Fastify (schema)
  if (validation) {
    return reply.code(400).send({
      error: 'Dados inválidos',
      message: 'Verifique os campos enviados',
      details: validation,
    });
  }

  // Erros do MySQL/MariaDB
  if (error.code) {
    switch (error.code) {
      case 'ER_DUP_ENTRY':
        return reply.code(409).send({
          error: 'Registro duplicado',
          message: 'Já existe um registro com esses dados',
        });
      case 'ER_NO_REFERENCED_ROW_2':
        return reply.code(400).send({
          error: 'Referência inválida',
          message: 'Um dos IDs informados não existe',
        });
      default:
        request.log.error(error, 'Database error');
        return reply.code(500).send({
          error: 'Erro interno',
          message: 'Erro ao processar operação no banco de dados',
        });
    }
  }

  // Erro genérico
  request.log.error(error, 'Unhandled error');
  reply.code(statusCode || 500).send({
    error: 'Erro interno',
    message: process.env.NODE_ENV === 'development' ? message : 'Erro interno do servidor',
  });
}
