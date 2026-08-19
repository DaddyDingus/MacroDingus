CREATE TABLE `integration_tokens` (
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
CREATE UNIQUE INDEX `integration_tokens_token_hash_unique` ON `integration_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `integration_tokens_user_created_idx` ON `integration_tokens` (`user_id`,`created_at`);
