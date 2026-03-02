ALTER TABLE `plugins` ADD `permissions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_default_pwd` integer DEFAULT 1 NOT NULL;