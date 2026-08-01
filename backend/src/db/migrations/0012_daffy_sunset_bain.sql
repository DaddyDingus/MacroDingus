ALTER TABLE `checkins` DROP COLUMN `target_calories`;--> statement-breakpoint
ALTER TABLE `checkins` DROP COLUMN `target_protein_g`;--> statement-breakpoint
ALTER TABLE `checkins` DROP COLUMN `target_carbs_g`;--> statement-breakpoint
ALTER TABLE `checkins` DROP COLUMN `target_fat_g`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `goal_type`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `target_rate_kg_per_week`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `protein_per_kg`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `fat_percent`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `goal_weight_kg`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `goal_started_at`;--> statement-breakpoint
ALTER TABLE `profiles` DROP COLUMN `goal_start_weight_kg`;