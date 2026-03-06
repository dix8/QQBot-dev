CREATE TABLE IF NOT EXISTS `message_rankings` (
	`type` text NOT NULL,
	`target_id` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`type`, `target_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_stats` (
	`hour` text PRIMARY KEY NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `logs_level_created_idx` ON `logs` (`level`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `logs_source_created_idx` ON `logs` (`source`,`created_at`);
