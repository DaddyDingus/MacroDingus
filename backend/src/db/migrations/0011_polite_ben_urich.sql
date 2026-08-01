CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`goal_type` text NOT NULL,
	`goal_weight_kg` real,
	`target_rate_kg_per_week` real NOT NULL,
	`started_at` text NOT NULL,
	`start_weight_kg` real,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goals_user_started_idx` ON `goals` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `program_days` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`target_calories` real NOT NULL,
	`target_protein_g` real NOT NULL,
	`target_carbs_g` real NOT NULL,
	`target_fat_g` real NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `program_days_program_day_idx` ON `program_days` (`program_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`style` text NOT NULL,
	`diet_type` text,
	`calorie_floor_kcal` real,
	`protein_level` text,
	`protein_per_kg_used` real,
	`distribution_mode` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `programs_user_started_idx` ON `programs` (`user_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `check_in_day_of_week` integer;