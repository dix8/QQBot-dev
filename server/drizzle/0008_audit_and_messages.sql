CREATE TABLE IF NOT EXISTS `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`username` text,
	`ip` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_action_created_idx` ON `audit_logs` (`action`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` integer,
	`message_type` text NOT NULL,
	`group_id` integer,
	`user_id` integer NOT NULL,
	`nickname` text,
	`raw_message` text,
	`time` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_type_group_idx` ON `messages` (`message_type`,`group_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_time_idx` ON `messages` (`time`);
