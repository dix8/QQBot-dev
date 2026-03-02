import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isDefaultPwd: integer('is_default_pwd').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const botConfig = sqliteTable('bot_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: text('level').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
  details: text('details'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  version: text('version').notNull(),
  description: text('description'),
  author: text('author'),
  repo: text('repo'),
  entryFile: text('entry_file').notNull(),
  enabled: integer('enabled').notNull().default(0),
  priority: integer('priority').notNull().default(100),
  permissions: text('permissions').notNull().default('[]'),
  configSchema: text('config_schema').notNull().default('[]'),
  commands: text('commands').notNull().default('[]'),
  installedAt: text('installed_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const pluginConfig = sqliteTable('plugin_config', {
  pluginId: text('plugin_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.pluginId, table.key] }),
]);

export const bots = sqliteTable('bots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  selfId: integer('self_id'),
  wsHost: text('ws_host').notNull().default('0.0.0.0'),
  wsPort: integer('ws_port').notNull().default(6199),
  wsToken: text('ws_token').notNull().default(''),
  enabled: integer('enabled').notNull().default(1),
  remark: text('remark').notNull().default(''),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  sentMessageCount: integer('sent_message_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
