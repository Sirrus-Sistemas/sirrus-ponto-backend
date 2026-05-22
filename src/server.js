import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { testConnection, closePool } from './config/database.js';
import { errorHandler } from './middlewares/errorHandler.js';
import authRoutes from './routes/auth.js';
import funcionarioRoutes from './routes/funcionarios.js';
import cadastrosRoutes from './routes/cadastros.js';
import marcacaoRoutes from './routes/marcacoes.js';
import escalasRoutes from './routes/escalas.js';
import ocorrenciasRoutes from './routes/ocorrencias.js';
import mobileRoutes from './routes/mobile.js';
import municipiosRoutes from './routes/municipios.js';
import usuariosRoutes from './routes/usuarios.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// ─── PLUGINS ──────────────────────────────────────────────────────────────
await app.register(cors, {
  origin: process.env.NODE_ENV === 'development' ? true : [/\.seudominio\.com\.br$/],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-troque-em-producao',
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────
app.setErrorHandler(errorHandler);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
});

// ─── ROTAS (prefixo /api) ─────────────────────────────────────────────────
await app.register(authRoutes, { prefix: '/api' });
await app.register(funcionarioRoutes, { prefix: '/api' });
await app.register(cadastrosRoutes, { prefix: '/api' });
await app.register(marcacaoRoutes, { prefix: '/api' });
await app.register(escalasRoutes, { prefix: '/api' });
await app.register(ocorrenciasRoutes, { prefix: '/api' });
await app.register(mobileRoutes, { prefix: '/api' });
await app.register(municipiosRoutes, { prefix: '/api' });
await app.register(usuariosRoutes, { prefix: '/api' });

// ─── START ────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // Testa conexão com o banco
    await testConnection();
    app.log.info('✅ Conexão com MariaDB estabelecida');

    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`🚀 Servidor rodando em http://${host}:${port}`);
    app.log.info(`📖 Endpoints disponíveis:`);
    app.log.info(`   POST   /api/auth/forgot-password`);
    app.log.info(`   POST   /api/auth/reset-password`);
    app.log.info(`   POST   /api/auth/login`);
    app.log.info(`   POST   /api/auth/refresh`);
    app.log.info(`   POST   /api/auth/logout`);
    app.log.info(`   PUT    /api/auth/change-password`);
    app.log.info(`   GET    /api/funcionarios`);
    app.log.info(`   GET    /api/funcionarios/me`);
    app.log.info(`   GET    /api/funcionarios/minha-equipe`);
    app.log.info(`   GET    /api/funcionarios/:id`);
    app.log.info(`   POST   /api/funcionarios`);
    app.log.info(`   PUT    /api/funcionarios/:id`);
    app.log.info(`   GET    /api/departamentos`);
    app.log.info(`   POST   /api/departamentos`);
    app.log.info(`   PUT    /api/departamentos/:id`);
    app.log.info(`   GET    /api/turnos`);
    app.log.info(`   POST   /api/turnos`);
    app.log.info(`   PUT    /api/turnos/:id`);
    app.log.info(`   GET    /api/feriados`);
    app.log.info(`   POST   /api/feriados`);
    app.log.info(`   POST   /api/marcacoes`);
    app.log.info(`   POST   /api/marcacoes`);
    app.log.info(`   GET    /api/marcacoes/espelho?ano=&mes=`);
    app.log.info(`   GET    /api/feriados?ano=`);
    app.log.info(`   POST   /api/feriados`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────
const shutdown = async (signal) => {
  app.log.info(`${signal} recebido. Encerrando...`);
  await app.close();
  await closePool();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
