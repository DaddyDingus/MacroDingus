CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`oidc_sid` text,
	`expires_at` integer NOT NULL,
	`refreshed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_sessions_expiry_idx` ON `app_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `app_sessions_oidc_sid_idx` ON `app_sessions` (`oidc_sid`);--> statement-breakpoint
CREATE INDEX `app_sessions_user_idx` ON `app_sessions` (`user_id`);