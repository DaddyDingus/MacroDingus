CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);--> statement-breakpoint
-- SQLite rejects ADD COLUMN with both REFERENCES and a non-NULL DEFAULT in the same
-- statement, and a NOT NULL column needs a default to satisfy the pre-existing empty
-- string check even on an empty table. Referential integrity for user_id is enforced
-- at the application layer instead (every log route is scoped through req.userId).
ALTER TABLE `logs` ADD `user_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `logs_user_date_idx` ON `logs` (`user_id`,`date`);