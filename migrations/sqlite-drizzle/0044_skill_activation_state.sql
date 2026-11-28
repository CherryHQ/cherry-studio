ALTER TABLE `agent_global_skill` ADD `activation_state` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
UPDATE `agent_global_skill`
SET `activation_state` = 'pending'
WHERE `source` = 'local' AND `source_url` IS NULL;
