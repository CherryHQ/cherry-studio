DROP INDEX `branch_anchor_branch_topic_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `branch_anchor_branch_topic_id_unique_idx` ON `branch_anchor` (`branch_topic_id`);