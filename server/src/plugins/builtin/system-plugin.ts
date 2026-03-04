import type { PluginInterface, PluginCommand } from '../../types/plugin.js';
import type { MessageEvent } from '../../types/onebot.js';
import type { OneBotClient } from '../../ws/onebot-client.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import type { ConfigService } from '../../services/config.js';
import type { PluginManager } from '../plugin-manager.js';
import type { BasicConfig } from '../../types/config.js';
import os from 'node:os';

export interface SystemPluginDependencies {
  oneBotClient: OneBotClient;
  connectionManager: ConnectionManager;
  configService: ConfigService;
  pluginManager: PluginManager;
  botIdResolver: (connectionId: string) => number | undefined;
  appVersion: string;
}

export class SystemPlugin implements PluginInterface {
  private oneBotClient!: OneBotClient;
  private connectionManager!: ConnectionManager;
  private configService!: ConfigService;
  private pluginManager!: PluginManager;
  private botIdResolver!: (connectionId: string) => number | undefined;
  private appVersion!: string;
  private startTime = Date.now();

  setDependencies(deps: SystemPluginDependencies): void {
    this.oneBotClient = deps.oneBotClient;
    this.connectionManager = deps.connectionManager;
    this.configService = deps.configService;
    this.pluginManager = deps.pluginManager;
    this.botIdResolver = deps.botIdResolver;
    this.appVersion = deps.appVersion;
  }

  getCommands(): PluginCommand[] {
    return [
      { command: '/帮助', description: '显示可用指令列表', permission: 'all', aliases: ['/help'] },
      { command: '/状态', description: '查看系统运行状态', permission: 'all', aliases: ['/status'] },
      { command: '/关于', description: '查看当前 Bot 信息', permission: 'all', aliases: ['/about'] },
      { command: '/昵称', description: '查看/设置 Bot 昵称', usage: '/昵称 [新昵称]', permission: 'master' },
      { command: '/主人列表', description: '列出所有主人 QQ', permission: 'master' },
      { command: '/添加主人', description: '添加主人', usage: '/添加主人 <QQ号>', permission: 'super_admin' },
      { command: '/删除主人', description: '删除主人', usage: '/删除主人 <QQ号>', permission: 'super_admin' },
      { command: '/插件列表', description: '查看已安装插件', permission: 'super_admin' },
      { command: '/启用插件', description: '启用指定插件', usage: '/启用插件 <序号或插件ID>', permission: 'super_admin' },
      { command: '/禁用插件', description: '禁用指定插件', usage: '/禁用插件 <序号或插件ID>', permission: 'super_admin' },
    ];
  }

  async onMessage(event: MessageEvent, connectionId: string): Promise<void> {
    const raw = event.raw_message?.trim();
    if (!raw || !raw.startsWith('/')) return;

    const botId = this.botIdResolver(connectionId);
    if (botId === undefined) return;

    const [cmd, ...args] = raw.split(/\s+/);
    const argStr = args.join(' ').trim();

    switch (cmd) {
      case '/帮助': case '/help':
        return this.cmdHelp(event, connectionId, botId);
      case '/状态': case '/status':
        return this.cmdStatus(event, connectionId);
      case '/关于': case '/about':
        return this.cmdAbout(event, connectionId, botId);
      case '/昵称':
        return this.cmdNickname(event, connectionId, botId, argStr);
      case '/主人列表':
        return this.cmdMasterList(event, connectionId, botId);
      case '/添加主人':
        return this.cmdMasterAdd(event, connectionId, botId, argStr);
      case '/删除主人':
        return this.cmdMasterRemove(event, connectionId, botId, argStr);
      case '/插件列表':
        return this.cmdPluginList(event, connectionId, botId);
      case '/启用插件':
        return this.cmdPluginToggle(event, connectionId, botId, argStr, true);
      case '/禁用插件':
        return this.cmdPluginToggle(event, connectionId, botId, argStr, false);
    }
  }

  // ==================== Helper ====================

  private async reply(event: MessageEvent, connectionId: string, text: string): Promise<void> {
    if (event.message_type === 'private') {
      await this.oneBotClient.sendPrivateMsg(connectionId, event.user_id, text);
    } else if (event.message_type === 'group') {
      await this.oneBotClient.sendGroupMsg(connectionId, (event as { group_id: number }).group_id, text);
    }
  }

  private isMaster(botId: number, userId: number): boolean {
    return this.configService.getMasterQQ(botId).includes(userId);
  }

  private isSuperAdmin(userId: number): boolean {
    return this.configService.getSuperAdminQQ().includes(userId);
  }

  private hasPermission(botId: number, userId: number, level: 'all' | 'master' | 'super_admin'): boolean {
    if (level === 'all') return true;
    if (level === 'master') return this.isSuperAdmin(userId) || this.isMaster(botId, userId);
    if (level === 'super_admin') return this.isSuperAdmin(userId);
    return false;
  }

  // ==================== Public Commands ====================

  private async cmdHelp(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    const userId = event.user_id;
    const isMasterUser = this.hasPermission(botId, userId, 'master');
    const isSuperAdminUser = this.hasPermission(botId, userId, 'super_admin');

    const lines = [
      '=== 可用指令 ===',
      '/帮助 - 显示可用指令列表',
      '/状态 - 查看系统运行状态',
      '/关于 - 查看当前 Bot 信息',
    ];

    if (isMasterUser) {
      lines.push(
        '',
        '=== 主人指令 ===',
        '/昵称 - 查看当前 Bot 昵称',
        '/昵称 <新昵称> - 设置 Bot 昵称',
        '/主人列表 - 列出所有主人 QQ',
      );
    }

    if (isSuperAdminUser) {
      lines.push(
        '',
        '=== 超管指令 ===',
        '/添加主人 <QQ号> - 添加主人',
        '/删除主人 <QQ号> - 删除主人',
        '/插件列表 - 查看已安装插件',
        '/启用插件 <序号或ID> - 启用插件',
        '/禁用插件 <序号或ID> - 禁用插件',
      );
    }

    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdStatus(event: MessageEvent, connectionId: string): Promise<void> {
    const uptimeMs = Date.now() - this.startTime;
    const uptime = this.formatUptime(uptimeMs);

    // Process memory
    const mem = process.memoryUsage();
    const rss = this.formatBytes(mem.rss);

    // System memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // CPU info
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times;
      totalTick += user + nice + sys + idle + irq;
      totalIdle += idle;
    }
    const cpuUsage = cpus.length > 0 ? ((1 - totalIdle / totalTick) * 100).toFixed(1) : '0';
    const cpuModel = cpus.length > 0 ? cpus[0]!.model.trim() : '未知';

    // Connections
    const connections = this.connectionManager.getAllConnections();
    const authenticated = connections.filter((c) => c.state === 'authenticated').length;

    const lines = [
      '=== 系统状态 ===',
      `运行时长: ${uptime}`,
      '',
      `CPU: ${cpuModel}`,
      `CPU 核心: ${cpus.length} 核`,
      `CPU 负载: ${cpuUsage}%`,
      '',
      `系统内存: ${this.formatBytes(usedMem)} / ${this.formatBytes(totalMem)} (${memPercent}%)`,
      `进程内存: ${rss}`,
      '',
      `连接数: ${authenticated}/${connections.length} 在线`,
      `系统: ${this.platformLabel()} | Node ${process.version}`,
    ];

    await this.reply(event, connectionId, lines.join('\n'));
  }

  private platformLabel(): string {
    const map: Record<string, string> = {
      win32: 'Windows',
      linux: 'Linux',
      darwin: 'macOS',
      freebsd: 'FreeBSD',
    };
    return map[os.platform()] || os.platform();
  }

  private async cmdAbout(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    const conn = this.connectionManager.getConnection(connectionId);
    const basic = this.configService.get<BasicConfig>(botId, 'basic');

    const lines = ['=== Bot 信息 ===', `QQBot 版本: v${this.appVersion}`];

    if (conn?.botInfo) {
      lines.push(`QQ: ${conn.botInfo.user_id}`);
      lines.push(`昵称: ${conn.botInfo.nickname}`);
    }

    if (basic?.nickname) {
      lines.push(`备注昵称: ${basic.nickname}`);
    }

    if (conn?.connectedAt) {
      lines.push(`连接时间: ${conn.connectedAt.toLocaleString()}`);
    }

    await this.reply(event, connectionId, lines.join('\n'));
  }

  // ==================== Master Commands ====================

  private async cmdNickname(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'master')) {
      await this.reply(event, connectionId, '权限不足：仅主人可使用此指令');
      return;
    }

    const basic = this.configService.get<BasicConfig>(botId, 'basic');

    if (!argStr) {
      await this.reply(event, connectionId, `当前昵称: ${basic?.nickname ?? 'QQBot'}`);
      return;
    }

    const updated: BasicConfig = { ...(basic ?? { nickname: 'QQBot', masterQQ: [], autoReply: true, messageScope: 'both' as const }), nickname: argStr };
    this.configService.set(botId, 'basic', updated);
    await this.reply(event, connectionId, `昵称已更新为: ${argStr}`);
  }

  private async cmdMasterList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'master')) {
      await this.reply(event, connectionId, '权限不足：仅主人可使用此指令');
      return;
    }

    const masters = this.configService.getMasterQQ(botId);
    if (masters.length === 0) {
      await this.reply(event, connectionId, '当前没有设置主人 QQ');
      return;
    }

    const lines = ['=== 主人列表 ===', ...masters.map((qq, i) => `${i + 1}. ${qq}`)];
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdMasterAdd(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const qq = parseInt(argStr, 10);
    if (!qq || isNaN(qq)) {
      await this.reply(event, connectionId, '请输入有效的 QQ 号，例如: /添加主人 123456');
      return;
    }

    const basic = this.configService.get<BasicConfig>(botId, 'basic');
    const masters = basic?.masterQQ ?? [];

    if (masters.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 已经是主人了`);
      return;
    }

    const updated: BasicConfig = { ...(basic ?? { nickname: 'QQBot', masterQQ: [], autoReply: true, messageScope: 'both' as const }), masterQQ: [...masters, qq] };
    this.configService.set(botId, 'basic', updated);
    await this.reply(event, connectionId, `已添加主人: ${qq}`);
  }

  private async cmdMasterRemove(event: MessageEvent, connectionId: string, botId: number, argStr: string): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const qq = parseInt(argStr, 10);
    if (!qq || isNaN(qq)) {
      await this.reply(event, connectionId, '请输入有效的 QQ 号，例如: /删除主人 123456');
      return;
    }

    const basic = this.configService.get<BasicConfig>(botId, 'basic');
    const masters = basic?.masterQQ ?? [];

    if (!masters.includes(qq)) {
      await this.reply(event, connectionId, `QQ ${qq} 不在主人列表中`);
      return;
    }

    if (masters.length === 1) {
      await this.reply(event, connectionId, '无法删除最后一个主人');
      return;
    }

    const updated: BasicConfig = { ...(basic ?? { nickname: 'QQBot', masterQQ: [], autoReply: true, messageScope: 'both' as const }), masterQQ: masters.filter((m) => m !== qq) };
    this.configService.set(botId, 'basic', updated);
    await this.reply(event, connectionId, `已删除主人: ${qq}`);
  }

  private getUserPlugins() {
    return this.pluginManager.getAllPlugins().filter((p) => !p.builtin);
  }

  private async cmdPluginList(event: MessageEvent, connectionId: string, botId: number): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    const plugins = this.getUserPlugins();
    if (plugins.length === 0) {
      await this.reply(event, connectionId, '当前没有已安装的插件');
      return;
    }

    const lines = ['=== 插件列表 ==='];
    plugins.forEach((p, i) => {
      const status = p.loaded ? '✅运行中' : p.enabled ? '🟡已启用' : '⬚已禁用';
      lines.push(`${i + 1}. [${status}] ${p.name} v${p.version}`);
      lines.push(`   ID: ${p.id}`);
      if (p.description) lines.push(`   描述: ${p.description}`);
    });
    lines.push('', '使用 /启用插件 或 /禁用插件 + 序号或插件ID');
    await this.reply(event, connectionId, lines.join('\n'));
  }

  private async cmdPluginToggle(event: MessageEvent, connectionId: string, botId: number, argStr: string, enable: boolean): Promise<void> {
    if (!this.hasPermission(botId, event.user_id, 'super_admin')) {
      await this.reply(event, connectionId, '权限不足：仅超级管理员可使用此指令');
      return;
    }

    if (!argStr) {
      await this.reply(event, connectionId, `请输入序号或插件ID，例如: ${enable ? '/启用插件 1' : '/禁用插件 1'}\n使用 /插件列表 查看所有插件`);
      return;
    }

    const plugins = this.getUserPlugins();

    // 支持序号匹配（正整数）或 ID 匹配
    const index = /^\d+$/.test(argStr) ? parseInt(argStr, 10) : NaN;
    const target = !isNaN(index) && index >= 1 && index <= plugins.length
      ? plugins[index - 1]
      : plugins.find((p) => p.id === argStr);

    if (!target) {
      await this.reply(event, connectionId, `未找到插件: ${argStr}\n使用 /插件列表 查看所有插件`);
      return;
    }

    if (enable && target.enabled) {
      await this.reply(event, connectionId, `插件 ${target.name} 已经是启用状态`);
      return;
    }
    if (!enable && !target.enabled) {
      await this.reply(event, connectionId, `插件 ${target.name} 已经是禁用状态`);
      return;
    }

    try {
      if (enable) {
        await this.pluginManager.enablePlugin(target.id);
        await this.reply(event, connectionId, `已启用插件: ${target.name}`);
      } else {
        await this.pluginManager.disablePlugin(target.id);
        await this.reply(event, connectionId, `已禁用插件: ${target.name}`);
      }
    } catch (err) {
      await this.reply(event, connectionId, `操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ==================== Utilities ====================

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}天`);
    if (hours > 0) parts.push(`${hours}小时`);
    parts.push(`${minutes}分钟`);
    return parts.join('');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
