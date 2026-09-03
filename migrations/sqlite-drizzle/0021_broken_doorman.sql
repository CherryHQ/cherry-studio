ALTER TABLE `user_model` ADD `preferred_endpoint_type` text;
--> statement-breakpoint
UPDATE `user_model`
SET `capabilities` = json_insert(`capabilities`, '$[#]', 'text-generation')
WHERE `capabilities` IS NOT NULL
  AND `preset_model_id` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(`user_model`.`capabilities`)
    WHERE `value` IN (
      'text-generation',
      'embedding',
      'rerank',
      'image-generation',
      'audio-transcript',
      'audio-generation',
      'video-generation'
    )
  );
