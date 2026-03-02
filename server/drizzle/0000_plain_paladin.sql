CREATE TABLE `bot_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`self_id` integer,
	`ws_host` text DEFAULT '0.0.0.0' NOT NULL,
	`ws_port` integer DEFAULT 6199 NOT NULL,
	`ws_token` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`author` text,
	`entry_file` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_name_unique` ON `plugins` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);