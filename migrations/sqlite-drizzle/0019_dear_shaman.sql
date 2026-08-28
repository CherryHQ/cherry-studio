ALTER TABLE `job` ADD `cancel_requested_at` integer;--> statement-breakpoint
-- Backfill pre-column rows: updated_at ≈ request time (the cancel tx was the last write);
-- terminal rows cap at finished_at because post-terminal no-op cancels bump updated_at.
UPDATE `job` SET `cancel_requested_at` = CASE
  WHEN `finished_at` IS NOT NULL AND `updated_at` > `finished_at` THEN `finished_at`
  ELSE `updated_at`
END
WHERE `cancel_requested` = 1 AND `cancel_requested_at` IS NULL;
