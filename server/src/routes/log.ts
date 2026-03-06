import type { FastifyInstance } from 'fastify';
import { logService } from '../services/log.js';
import type { LogLevel, LogSource } from '../types/log.js';

export function logRoutes(fastify: FastifyInstance): void {
  // GET /api/logs — query logs with filtering and pagination
  fastify.get<{
    Querystring: {
      level?: LogLevel;
      source?: LogSource;
      search?: string;
      page?: string;
      limit?: string;
    };
  }>('/api/logs', async (request) => {
    const { level, source, search, page, limit } = request.query;
    return logService.queryLogs({
      level,
      source,
      search: search?.slice(0, 200),
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  });

  // GET /api/logs/since/:id — incremental polling
  fastify.get<{ Params: { id: string }; Querystring: { level?: LogLevel } }>('/api/logs/since/:id', async (request) => {
    const sinceId = parseInt(request.params.id, 10);
    const logs = logService.getLogsSince(sinceId, request.query.level);
    return { logs };
  });

  // DELETE /api/logs — clear all logs
  fastify.delete('/api/logs', async () => {
    logService.clearLogs();
    return { success: true };
  });
}
