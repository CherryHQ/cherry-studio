ALTER TABLE `user_model` ADD `capabilities_explicit` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill pre-column rows: a stored snapshot is the only provenance on upgraded
-- databases. Preset rows hold null unless the migrator preserved a v1 explicit
-- selection (including explicit disables stored as []), so any non-null preset
-- snapshot is user intent. Custom rows keep the [] default from creation, which
-- means "never set" and must stay healable; only a non-empty custom snapshot
-- (v1 selection or v2-era edit) is pinned.
UPDATE `user_model` SET `capabilities_explicit` = 1
WHERE (`preset_model_id` IS NOT NULL AND `capabilities` IS NOT NULL)
   OR (`capabilities` IS NOT NULL AND `capabilities` != '[]');
