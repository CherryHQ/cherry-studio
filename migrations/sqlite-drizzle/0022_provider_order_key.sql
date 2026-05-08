ALTER TABLE `user_provider` ADD `order_key` text NOT NULL DEFAULT '';
--> statement-breakpoint
WITH ordered AS (
  SELECT
    `provider_id`,
    row_number() OVER (ORDER BY COALESCE(`sort_order`, 0), `provider_id`) - 1 AS `order_index`
  FROM `user_provider`
),
keyspace(`depth`, `start_index`, `capacity`) AS (
  SELECT 1, 0, 62
  UNION ALL
  SELECT `depth` + 1, `start_index` + `capacity`, `capacity` * 62
  FROM keyspace
  WHERE `depth` < 8
),
ranked AS (
  SELECT
    ordered.`provider_id`,
    ordered.`order_index` - keyspace.`start_index` AS `offset`,
    keyspace.`depth`
  FROM ordered
  JOIN keyspace
    ON ordered.`order_index` >= keyspace.`start_index`
   AND ordered.`order_index` < keyspace.`start_index` + keyspace.`capacity`
),
encoded(`provider_id`, `depth`, `offset`, `position`, `key_tail`) AS (
  SELECT `provider_id`, `depth`, `offset`, 0, ''
  FROM ranked
  UNION ALL
  SELECT
    `provider_id`,
    `depth`,
    CAST(`offset` / 62 AS INTEGER),
    `position` + 1,
    substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (`offset` % 62) + 1, 1) || `key_tail`
  FROM encoded
  WHERE `position` < `depth`
),
new_keys AS (
  SELECT
    `provider_id`,
    substr('abcdefghijklmnopqrstuvwxyz', `depth`, 1) || `key_tail` AS `new_order_key`
  FROM encoded
  WHERE `position` = `depth`
)
UPDATE `user_provider`
SET `order_key` = (
  SELECT `new_order_key`
  FROM new_keys
  WHERE new_keys.`provider_id` = `user_provider`.`provider_id`
);
--> statement-breakpoint
DROP INDEX `user_provider_enabled_sort_idx`;
--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);
--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);
