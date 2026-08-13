CREATE TABLE `event_plan_days` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`date` text NOT NULL,
	`kcal_delta` real NOT NULL,
	`protein_delta` real NOT NULL,
	`carbs_delta` real NOT NULL,
	`fat_delta` real NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `event_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_plan_days_plan_date_idx` ON `event_plan_days` (`plan_id`,`date`);--> statement-breakpoint
CREATE TABLE `event_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_date` text NOT NULL,
	`label` text,
	`kind` text NOT NULL,
	`event_kcal` real NOT NULL,
	`window_mode` text NOT NULL,
	`lead_days` integer NOT NULL,
	`trail_days` integer NOT NULL,
	`distribution_mode` text NOT NULL,
	`settled_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_plans_user_date_idx` ON `event_plans` (`user_id`,`event_date`);