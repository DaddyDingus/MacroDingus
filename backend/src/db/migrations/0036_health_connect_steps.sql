CREATE TABLE `steps_webhook_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `steps_webhook_tokens_token_hash_unique` ON `steps_webhook_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `steps_webhook_tokens_user_created_idx` ON `steps_webhook_tokens` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `step_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_key` text NOT NULL,
	`source_app` text,
	`count` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`payload_timestamp` text NOT NULL,
	`app_version` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_records_user_source_idx` ON `step_records` (`user_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `step_records_user_start_idx` ON `step_records` (`user_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `step_records_user_end_idx` ON `step_records` (`user_id`,`end_time`);--> statement-breakpoint
CREATE TABLE `step_daily_totals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`steps` integer NOT NULL,
	`complete` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `step_daily_totals_user_date_idx` ON `step_daily_totals` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `step_sync_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_successful_sync_at` text NOT NULL,
	`last_payload_timestamp` text NOT NULL,
	`last_app_version` text NOT NULL,
	`last_record_end_at` text,
	`last_record_count` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
