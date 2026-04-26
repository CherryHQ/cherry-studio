ALTER TABLE `user_provider` ADD `order_key` text NOT NULL DEFAULT '';
--> statement-breakpoint
WITH ranked AS (
  SELECT
    `provider_id`,
    printf('%020d', row_number() OVER (ORDER BY COALESCE(`sort_order`, 0), `provider_id`) - 1) AS `new_order_key`
  FROM `user_provider`
)
UPDATE `user_provider`
SET `order_key` = (
  SELECT `new_order_key`
  FROM ranked
  WHERE ranked.`provider_id` = `user_provider`.`provider_id`
);
--> statement-breakpoint
DROP INDEX `user_provider_enabled_sort_idx`;
--> statement-breakpoint
CREATE INDEX `user_provider_enabled_idx` ON `user_provider` (`is_enabled`);
--> statement-breakpoint
CREATE INDEX `user_provider_order_key_idx` ON `user_provider` (`order_key`);
