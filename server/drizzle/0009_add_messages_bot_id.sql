ALTER TABLE `messages` ADD `bot_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_bot_idx` ON `messages` (`bot_id`);
