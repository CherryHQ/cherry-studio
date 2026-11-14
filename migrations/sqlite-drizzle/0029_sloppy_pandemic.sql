ALTER TABLE `job` ADD `recovery` text;--> statement-breakpoint
-- Conversions Knowledge started before this column existed get the override it now passes, so a
-- restart abandons them too. Rows are matched the way the result check identifies an item's conversion.
UPDATE `job` SET `recovery` = 'abandon'
WHERE `type` IN ('file-processing.background', 'file-processing.background-local', 'file-processing.remote-poll')
  AND `status` IN ('pending', 'delayed', 'running')
  AND json_extract(`input`, '$.feature') = 'document_to_markdown'
  AND json_extract(`input`, '$.output.kind') = 'path'
  AND json_extract(`input`, '$.context.dataId') IN (SELECT `id` FROM `knowledge_item`);
