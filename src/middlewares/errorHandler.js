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

  // Erros do MySQL/MariaDB — sqlState só existe em erros vindos do driver
  // (mysql2); erros nativos do Fastify (ex.: corpo grande demais, rotas
  // não encontradas) também têm `.code`, mas nunca `.sqlState`, e não
  // devem cair aqui como se fossem falha de banco.
  if (error.code && error.sqlState) {
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
  const status = statusCode || 500;
  // 4xx é sempre uma mensagem que o próprio código escreveu de propósito pra
  // explicar algo ao usuário (CPF/senha inválidos, mês já fechado, etc.) —
  // nunca vaza detalhe interno, então não tem por que esconder em produção.
  // Só 5xx (falha inesperada de verdade) continua escondido fora de dev.
  const mensagemSegura = status < 500 || process.env.NODE_ENV === 'development';
  reply.code(status).send({
    error: 'Erro interno',
    message: mensagemSegura ? message : 'Erro interno do servidor',
  });
}
