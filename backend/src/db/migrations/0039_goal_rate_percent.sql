ALTER TABLE `goals` ADD `target_rate_percent_per_week` real;
--> statement-breakpoint
UPDATE `goals`
SET `target_rate_percent_per_week` = (`target_rate_kg_per_week` / `start_weight_kg`) * 100
WHERE `start_weight_kg` IS NOT NULL AND `start_weight_kg` > 0;
