import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { createWsService } from './ws/index.js';
import { connectionRoutes } from './routes/connection.js';
import { authRoutes } from './routes/auth.js';
import { configRoutes } from './routes/config.js';
import { logRoutes } from './routes/log.js';
import { pluginRoutes } from './routes/plugin.js';
import { botRoutes } from './routes/bot.js';
import { registerJwt } from './plugins/jwt.js';
import { registerAuthHook } from './plugins/auth-hook.js';
import { authService } from './services/auth.js';
import { configService } from './services/config.js';
import { logService } from './services/log.js';
import { PluginManager } from './plugins/plugin-manager.js';
import { SystemPlugin } from './plugins/builtin/system-plugin.js';
import { db, schema } from './db/index.js';
import { sql } from 'drizzle-orm';
import { nowISO } from './utils/date.js';
import { env } from './config/env.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as {
  version: string;
  name: string;
  description: string;
  author: string;
  license: string;
  homepage: string;
  repository: { url: string };
};
const APP_VERSION = pkg.version;

const fastify = Fastify({ logger: true, trustProxy: true });

// CORS: production uses Docker 同源 or CORS_ORIGIN env; development defaults to allow all
await fastify.register(cors, {
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
});
await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

// Global error handler — log unexpected errors and return a unified Chinese message
fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  fastify.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500) {
    reply.code(statusCode).send({ error: '服务器内部错误，请稍后重试' });
  } else {
    reply.code(statusCode).send({ error: error.message });
  }
});

// Database is initialized on import; seed default admin account
await authService.seedDefaultAdmin();

// JWT & auth hook
await registerJwt(fastify);
registerAuthHook(fastify);

// WebSocket service (per-bot reverse WS servers)
const ws = createWsService(fastify.log, {
  heartbeatTimeoutMs: env.HEARTBEAT_TIMEOUT_MS,
  apiTimeoutMs: env.API_TIMEOUT_MS,
});

await ws.start();

// Wire up config service and plugin manager to event handler
ws.eventHandler.setConfigService(configService);

const pluginManager = new PluginManager(fastify.log);
pluginManager.setOneBotClient(ws.oneBotClient);
pluginManager.setConnectionManager(ws.connectionManager);
ws.eventHandler.setPluginManager(pluginManager);

// Register built-in system plugin
const systemPlugin = new SystemPlugin();
systemPlugin.setDependencies({
  oneBotClient: ws.oneBotClient,
  connectionManager: ws.connectionManager,
  configService,
  pluginManager,
  botIdResolver: (cid) => ws.reverseWsManager.getBotIdByConnectionId(cid),
  appVersion: APP_VERSION,
});
pluginManager.registerBuiltinPlugin('system', '系统管理', systemPlugin, 0);

// Install preinstalled plugins (first run only, respects user deletion)
await pluginManager.installPreinstalledPlugins();

// Initialize plugins (load all enabled plugins)
await pluginManager.initialize();

// REST API routes
authRoutes(fastify);
connectionRoutes(fastify, ws.connectionManager, ws.oneBotClient);
configRoutes(fastify);
logRoutes(fastify);
pluginRoutes(fastify, pluginManager);
botRoutes(fastify, ws.connectionManager, ws.reverseWsManager);

// Static file serving — serve frontend build in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: non-API routes return index.html
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
      reply.code(404).send({ error: '接口不存在' });
    } else {
      return reply.sendFile('index.html');
    }
  });
}

// Health check — basic status for unauthenticated, detailed for authenticated
fastify.get('/api/health', async (request) => {
  // Check if the request has a valid JWT (optional auth)
  let authenticated = false;
  try {
    await request.jwtVerify();
    authenticated = true;
  } catch {
    // Not authenticated — return minimal info
  }

  if (!authenticated) {
    return { status: 'ok' };
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Calculate CPU usage from cpus() idle vs total
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    totalTick += user + nice + sys + idle + irq;
    totalIdle += idle;
  }
  const cpuUsage = cpus.length > 0 ? ((1 - totalIdle / totalTick) * 100) : 0;

  // Bot statistics
  const allBots = db.select().from(schema.bots).all();
  const totalBots = allBots.length;
  const enabledBots = allBots.filter(b => b.enabled).length;
  const connectedBots = allBots.filter(b => {
    const connId = ws.reverseWsManager.getConnectionId(b.id);
    return connId && ws.connectionManager.getConnection(connId);
  }).length;

  // Sum all sent messages across bots
  const msgResult = db.select({ total: sql<number>`coalesce(sum(sent_message_count), 0)` }).from(schema.bots).get();
  const totalMessagesSent = msgResult?.total ?? 0;

  return {
    status: 'ok',
    timestamp: nowISO(),
    connections: ws.connectionManager.getActiveCount(),
    totalMessagesSent,
    bots: {
      total: totalBots,
      enabled: enabledBots,
      connected: connectedBots,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Number(((usedMem / totalMem) * 100).toFixed(1)),
    },
    cpu: {
      cores: cpus.length,
      usage: Number(cpuUsage.toFixed(1)),
      model: cpus.length > 0 ? cpus[0].model : '',
    },
  };
});

// About info — project metadata for the About page
const serverStartTime = nowISO();
fastify.get('/api/about', async () => {
  const allPlugins = db.select().from(schema.plugins).all();
  const allBots = db.select().from(schema.bots).all();
  return {
    version: APP_VERSION,
    name: pkg.description || pkg.name,
    author: pkg.author,
    license: pkg.license,
    homepage: pkg.homepage,
    repository: pkg.repository?.url?.replace(/\.git$/, '') || '',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.floor(process.uptime()),
    startTime: serverStartTime,
    dbPath: env.DB_PATH,
    pluginCount: allPlugins.length,
    botCount: allBots.length,
  };
});

logService.addLog('info', 'system', '服务启动');

// Graceful shutdown
const shutdown = async (signal: string) => {
  fastify.log.info({ signal }, 'Received shutdown signal');
  logService.addLog('info', 'system', `服务关闭: ${signal}`);
  await pluginManager.unloadAll();
  await ws.close();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await fastify.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
