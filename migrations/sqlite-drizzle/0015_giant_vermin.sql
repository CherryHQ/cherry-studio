-- Step 1: Add `order_key` with empty-string sentinel default. The sentinel
-- lets the column carry NOT NULL on populated tables (SQLite rejects
-- ALTER TABLE ADD ... NOT NULL without DEFAULT). DbService.runPostMigrateBackfills()
-- upgrades '' to canonical fractional-indexing keys after migrate() returns.
-- Spec: docs/references/data/data-ordering-guide.md §7 step 6.
ALTER TABLE `topic` ADD `order_key` text NOT NULL DEFAULT '';--> statement-breakpoint
-- Step 2: Pre-emit pin rows for legacy is_pinned=1 topics so the column drop
-- in step 4 doesn't lose pin state. WHERE NOT EXISTS keeps this idempotent
-- across migration retries. The empty-string sentinel order_key is upgraded
-- by the same TS post-hook (sorted by topic.updated_at DESC via JOIN).
INSERT INTO `pin` (`id`, `entity_type`, `entity_id`, `order_key`, `created_at`, `updated_at`)
SELECT 'pin-mig-' || topic.id, 'topic', topic.id, '', unixepoch() * 1000, unixepoch() * 1000
FROM `topic`
WHERE topic.is_pinned = 1
  AND NOT EXISTS (
    SELECT 1 FROM `pin` WHERE pin.entity_type = 'topic' AND pin.entity_id = topic.id
  );--> statement-breakpoint
-- Step 3: Drop legacy ordering indexes (must precede DROP COLUMN of the columns they reference).
DROP INDEX `topic_group_sort_idx`;--> statement-breakpoint
DROP INDEX `topic_is_pinned_idx`;--> statement-breakpoint
-- Step 4: Drop legacy columns. Pin state is preserved in `pin` via step 2; sort_order/pinned_order are obsolete under the order_key model.
ALTER TABLE `topic` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `is_pinned`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `pinned_order`;--> statement-breakpoint
-- Step 5: Create the new partitioned order_key index.
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);
