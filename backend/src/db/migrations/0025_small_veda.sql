CREATE TABLE `food_search_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`normalized_query` text NOT NULL,
	`search_count` integer DEFAULT 0 NOT NULL,
	`local_miss_count` integer DEFAULT 0 NOT NULL,
	`selection_count` integer DEFAULT 0 NOT NULL,
	`remote_selection_count` integer DEFAULT 0 NOT NULL,
	`last_result_count` integer DEFAULT 0 NOT NULL,
	`last_searched_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_search_stats_user_query_idx` ON `food_search_stats` (`user_id`,`normalized_query`);--> statement-breakpoint
ALTER TABLE `foods` ADD `measures_json` text;