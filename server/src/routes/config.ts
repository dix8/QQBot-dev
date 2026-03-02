import type { FastifyInstance } from 'fastify';
import { configService } from '../services/config.js';
import { logService } from '../services/log.js';
import type { ConfigSection } from '../types/config.js';

const VALID_SECTIONS: ConfigSection[] = ['basic', 'message', 'runtime'];

export function configRoutes(fastify: FastifyInstance): void {
  // GET /api/system/super-admins
  fastify.get('/api/system/super-admins', async () => {
    return { list: configService.getSuperAdminQQ() };
  });

  // PUT /api/system/super-admins
  fastify.put('/api/system/super-admins', async (request, reply) => {
    const body = request.body as { list?: unknown };
    if (!body || !Array.isArray(body.list)) {
      return reply.status(400).send({ error: 'list 必须是数组' });
    }
    const list = body.list;
    if (!list.every((v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0)) {
      return reply.status(400).send({ error: 'list 中每个元素必须是正整数' });
    }
    configService.setSuperAdminQQ(list as number[]);
    logService.addLog('info', 'config', `超级管理员列表已更新: ${(list as number[]).join(', ')}`);
    return { success: true };
  });

  // GET /api/bots/:botId/config/export
  fastify.get<{ Params: { botId: string } }>('/api/bots/:botId/config/export', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.status(400).send({ error: '无效的 botId' });
    return configService.exportAll(botId);
  });

  // POST /api/bots/:botId/config/import
  fastify.post<{ Params: { botId: string } }>('/api/bots/:botId/config/import', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.status(400).send({ error: '无效的 botId' });
    const data = request.body;
    if (!data || typeof data !== 'object') {
      return reply.status(400).send({ error: '无效的配置数据' });
    }
    try {
      configService.importAll(botId, data);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : '配置数据校验失败' });
    }
    logService.addLog('info', 'config', `配置已导入: botId=${botId}`);
    return { success: true };
  });

  // GET /api/bots/:botId/config — get all config for a bot
  fastify.get<{ Params: { botId: string } }>('/api/bots/:botId/config', async (request, reply) => {
    const botId = parseInt(request.params.botId, 10);
    if (isNaN(botId)) return reply.status(400).send({ error: '无效的 botId' });
    return configService.getAllForBot(botId);
  });

  // GET /api/bots/:botId/config/:section
  fastify.get<{ Params: { botId: string; section: string } }>(
    '/api/bots/:botId/config/:section',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.status(400).send({ error: '无效的 botId' });
      const { section } = request.params;
      if (!VALID_SECTIONS.includes(section as ConfigSection)) {
        return reply.status(400).send({ error: `无效的配置节: ${section}` });
      }
      return configService.get(botId, section);
    },
  );

  // PUT /api/bots/:botId/config/:section
  fastify.put<{ Params: { botId: string; section: string } }>(
    '/api/bots/:botId/config/:section',
    async (request, reply) => {
      const botId = parseInt(request.params.botId, 10);
      if (isNaN(botId)) return reply.status(400).send({ error: '无效的 botId' });
      const { section } = request.params;
      if (!VALID_SECTIONS.includes(section as ConfigSection)) {
        return reply.status(400).send({ error: `无效的配置节: ${section}` });
      }
      const value = request.body;
      if (!value || typeof value !== 'object') {
        return reply.status(400).send({ error: '无效的配置值' });
      }
      configService.set(botId, section, value);
      logService.addLog('info', 'config', `配置已更新: botId=${botId} section=${section}`);
      return { success: true };
    },
  );
}
