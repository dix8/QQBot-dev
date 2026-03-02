import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync, existsSync, createReadStream, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import type { PluginManager } from '../plugins/plugin-manager.js';

const UPLOAD_TMP_DIR = resolve('data/tmp');

export function pluginRoutes(fastify: FastifyInstance, pluginManager: PluginManager): void {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

  // GET /api/plugins — list all plugins
  fastify.get('/api/plugins', async () => {
    return { plugins: pluginManager.getAllPlugins() };
  });

  // GET /api/plugins/:id — plugin detail
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info) {
      return reply.status(404).send({ error: '插件不存在' });
    }
    return info;
  });

  // GET /api/plugins/:id/icon — serve plugin icon (public, no auth required)
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/icon', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info || info.builtin) {
      return reply.status(404).send({ error: '插件不存在' });
    }
    const iconPath = join(pluginManager.getPluginDir(request.params.id), 'icon.png');
    if (!existsSync(iconPath)) {
      return reply.status(404).send({ error: '图标不存在' });
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(createReadStream(iconPath));
  });

  // GET /api/plugins/:id/readme — serve plugin README.md (requires auth)
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/readme', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info || info.builtin) {
      return reply.status(404).send({ error: '插件不存在' });
    }
    const readmePath = join(pluginManager.getPluginDir(request.params.id), 'README.md');
    if (!existsSync(readmePath)) {
      return reply.status(404).send({ error: '文档不存在' });
    }
    const content = readFileSync(readmePath, 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // POST /api/plugins/upload — upload and install plugin zip
  fastify.post('/api/plugins/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: '未上传文件' });
    }

    const buffer = await file.toBuffer();
    const tmpDir = join(UPLOAD_TMP_DIR, `plugin-${Date.now()}`);

    try {
      const zip = new AdmZip(buffer);

      // Zip Slip protection: reject entries that escape tmpDir
      const resolvedTmpDir = resolve(tmpDir) + sep;
      for (const entry of zip.getEntries()) {
        const entryPath = resolve(tmpDir, entry.entryName);
        if (!entryPath.startsWith(resolvedTmpDir)) {
          return reply.status(400).send({ error: '插件包含非法路径' });
        }
      }

      zip.extractAllTo(tmpDir, true);

      const info = await pluginManager.installPlugin(tmpDir);
      return info;
    } catch (err) {
      return reply.status(400).send({ error: String(err instanceof Error ? err.message : err) });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // POST /api/plugins/:id/enable
  fastify.post<{ Params: { id: string } }>('/api/plugins/:id/enable', async (request, reply) => {
    try {
      await pluginManager.enablePlugin(request.params.id);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // POST /api/plugins/:id/disable
  fastify.post<{ Params: { id: string } }>('/api/plugins/:id/disable', async (request, reply) => {
    try {
      await pluginManager.disablePlugin(request.params.id);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // PUT /api/plugins/:id/priority
  fastify.put<{ Params: { id: string }; Body: { priority: number } }>(
    '/api/plugins/:id/priority',
    async (request, reply) => {
      const { priority } = request.body as { priority: number };
      if (typeof priority !== 'number' || priority < 0) {
        return reply.status(400).send({ error: '无效的优先级值' });
      }
      pluginManager.updatePriority(request.params.id, priority);
      return { success: true };
    },
  );

  // DELETE /api/plugins/:id
  fastify.delete<{ Params: { id: string } }>('/api/plugins/:id', async (request, reply) => {
    try {
      await pluginManager.deletePlugin(request.params.id);
      return { success: true };
    } catch (err) {
      return reply.status(400).send({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  // GET /api/plugins/:id/config — get plugin config schema + current values
  fastify.get<{ Params: { id: string } }>('/api/plugins/:id/config', async (request, reply) => {
    const info = pluginManager.getPluginInfo(request.params.id);
    if (!info) {
      return reply.status(404).send({ error: '插件不存在' });
    }
    const values = pluginManager.getPluginConfigValues(request.params.id);
    // Merge defaults for keys not yet set
    const merged: Record<string, unknown> = {};
    for (const item of info.configSchema) {
      merged[item.key] = item.key in values ? values[item.key] : item.default;
    }
    return { schema: info.configSchema, values: merged };
  });

  // PUT /api/plugins/:id/config — save plugin config values
  fastify.put<{ Params: { id: string }; Body: { values: Record<string, unknown> } }>(
    '/api/plugins/:id/config',
    async (request, reply) => {
      const info = pluginManager.getPluginInfo(request.params.id);
      if (!info) {
        return reply.status(404).send({ error: '插件不存在' });
      }
      const { values } = request.body as { values: Record<string, unknown> };
      if (!values || typeof values !== 'object') {
        return reply.status(400).send({ error: '无效的配置数据' });
      }
      try {
        pluginManager.setPluginConfigValues(request.params.id, values);
        return { success: true };
      } catch (err) {
        return reply.status(400).send({ error: String(err instanceof Error ? err.message : err) });
      }
    },
  );
}
