CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`barcode` text,
	`source` text DEFAULT 'custom' NOT NULL,
	`serving_size_grams` real,
	`serving_name` text,
	`calories_per_100g` real NOT NULL,
	`protein_per_100g` real NOT NULL,
	`carbs_per_100g` real NOT NULL,
	`fat_per_100g` real NOT NULL,
	`fiber_per_100g` real,
	`sugar_per_100g` real,
	`saturated_fat_per_100g` real,
	`sodium_mg_per_100g` real,
	`micros_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `foods_name_idx` ON `foods` (`name`);--> statement-breakpoint
CREATE INDEX `foods_barcode_idx` ON `foods` (`barcode`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`food_id` text NOT NULL,
	`quantity_grams` real NOT NULL,
	`logged_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `logs_date_idx` ON `logs` (`date`);--> statement-breakpoint
CREATE INDEX `logs_food_idx` ON `logs` (`food_id`);