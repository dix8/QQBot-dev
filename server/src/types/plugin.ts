// ==================== Plugin Types ====================

import type { MessageEvent, NoticeEvent, RequestEvent, MessageSegment } from './onebot.js';

export type PluginPermission = 'sendMessage' | 'callApi' | 'getConfig' | 'setConfig';

export interface PluginConfigItem {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: unknown;
  description?: string;
  options?: { label: string; value: string | number }[];
  required?: boolean;
  placeholder?: string;
  /** Custom editor component identifier (e.g. "scheduled-messages") */
  editor?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  repo?: string;
  entry: string;
  permissions?: PluginPermission[];
  configSchema?: PluginConfigItem[];
  commands?: PluginCommand[];
}

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PluginContext {
  /** Send a message through the bot */
  sendMessage(
    type: 'private' | 'group',
    target: number,
    message: MessageSegment[] | string,
  ): Promise<void>;
  /** Call any OneBot V11 API action (e.g. 'send_like', 'get_group_list') */
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Get a config value */
  getConfig(key: string): unknown;
  /** Get a bot-level config section (e.g. 'basic') — read-only access to bot configuration */
  getBotConfig(section: string): unknown;
  /** Set a config value (persisted to database) */
  setConfig(key: string, value: unknown): void;
  /** Plugin-scoped logger */
  logger: PluginLogger;
  /** Plugin data directory */
  dataDir: string;
  /** Managed setTimeout — automatically cleared on plugin unload */
  setTimeout(callback: () => void, ms: number): number;
  /** Managed setInterval — automatically cleared on plugin unload */
  setInterval(callback: () => void, ms: number): number;
  /** Clear a managed timeout */
  clearTimeout(id: number): void;
  /** Clear a managed interval */
  clearInterval(id: number): void;
}

export interface PluginCommand {
  command: string;
  description: string;
  usage?: string;
  permission: 'all' | 'master' | 'super_admin';
  aliases?: string[];
}

export interface PluginInterface {
  onLoad?(context: PluginContext): Promise<void> | void;
  onUnload?(): Promise<void> | void;
  onMessage?(event: MessageEvent, connectionId: string): Promise<void> | void;
  onNotice?(event: NoticeEvent, connectionId: string): Promise<void> | void;
  onRequest?(event: RequestEvent, connectionId: string): Promise<void> | void;
  getCommands?(): PluginCommand[];
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  entryFile: string;
  enabled: number;
  priority: number;
  permissions: string;
  configSchema: string;
  commands: string;
  installedAt: string;
  updatedAt: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  repo: string | null;
  enabled: boolean;
  priority: number;
  loaded: boolean;
  errorCount: number;
  installedAt: string;
  updatedAt: string;
  builtin: boolean;
  hasIcon: boolean;
  hasReadme: boolean;
  commands: PluginCommand[];
  permissions: PluginPermission[];
  configSchema: PluginConfigItem[];
}
