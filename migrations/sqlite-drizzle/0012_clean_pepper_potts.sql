ALTER TABLE `agent_session_message` ADD `fts_rowid` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_session_message_fts_rowid_uniq` ON `agent_session_message` (`fts_rowid`);--> statement-breakpoint
ALTER TABLE `message` ADD `fts_rowid` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `message_fts_rowid_uniq` ON `message` (`fts_rowid`);