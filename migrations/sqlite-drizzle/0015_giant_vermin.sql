-- Step 1: Add `order_key` with a temporary 'a0' default (a valid fractional-indexing key)
-- so SQLite accepts the NOT NULL constraint on populated tables. Step 2 immediately
-- overwrites every row with a canonical per-partition key — the default is only the
-- column's metadata after this migration, never an observable row value.
ALTER TABLE `topic` ADD `order_key` text NOT NULL DEFAULT 'a0';--> statement-breakpoint
-- Step 2: Stamp canonical fractional-indexing keys per `group_id` partition. Uses the
-- 'b' tier (3 chars: 'b' + 2 base62 digits = 3844 keys/partition, ample for topics)
-- ordered by `updated_at DESC` so the most recent rows land at the head — matches
-- what `assignOrderKeysByScope(rows, updated_at DESC)` would emit at runtime.
WITH ranked AS (
  SELECT id,
    'b' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      ((ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY updated_at DESC, id ASC) - 1) / 62) + 1, 1) ||
    substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      ((ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY updated_at DESC, id ASC) - 1) % 62) + 1, 1) AS new_key
  FROM topic
)
UPDATE topic SET order_key = (SELECT new_key FROM ranked WHERE ranked.id = topic.id) WHERE EXISTS (SELECT 1 FROM ranked WHERE ranked.id = topic.id);--> statement-breakpoint
-- Step 3: Pre-emit pin rows for legacy `is_pinned=1` topics. Same 'b' tier + ROW_NUMBER
-- pattern, ordered by topic.updated_at DESC (recently-pinned land at head). WHERE NOT
-- EXISTS keeps the migration idempotent across retries.
INSERT INTO `pin` (`id`, `entity_type`, `entity_id`, `order_key`, `created_at`, `updated_at`)
SELECT
  'pin-mig-' || ranked.id,
  'topic',
  ranked.id,
  'b' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((ranked.rn - 1) / 62) + 1, 1) ||
        substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((ranked.rn - 1) % 62) + 1, 1),
  unixepoch() * 1000,
  unixepoch() * 1000
FROM (
  SELECT topic.id AS id,
    ROW_NUMBER() OVER (ORDER BY topic.updated_at DESC, topic.id ASC) AS rn
  FROM topic
  WHERE topic.is_pinned = 1
    AND NOT EXISTS (SELECT 1 FROM pin WHERE pin.entity_type = 'topic' AND pin.entity_id = topic.id)
) ranked;--> statement-breakpoint
-- Step 4: Drop legacy ordering indexes (must precede DROP COLUMN of the columns they reference).
DROP INDEX `topic_group_sort_idx`;--> statement-breakpoint
DROP INDEX `topic_is_pinned_idx`;--> statement-breakpoint
-- Step 5: Drop legacy columns. Pin state preserved in `pin` via step 3; sort_order/pinned_order are obsolete under order_key.
ALTER TABLE `topic` DROP COLUMN `sort_order`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `is_pinned`;--> statement-breakpoint
ALTER TABLE `topic` DROP COLUMN `pinned_order`;--> statement-breakpoint
-- Step 6: Create the new partitioned order_key index.
CREATE INDEX `topic_group_id_order_key_idx` ON `topic` (`group_id`,`order_key`);
