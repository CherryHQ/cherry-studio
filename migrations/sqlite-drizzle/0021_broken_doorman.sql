ALTER TABLE `user_model` ADD `preferred_endpoint_type` text;
--> statement-breakpoint
UPDATE `user_model`
SET `capabilities` = json_insert(
  `capabilities`,
  '$[#]',
  CASE
    WHEN EXISTS (SELECT 1 FROM json_each(`user_model`.`input_modalities`) WHERE `value` = 'audio')
      AND NOT EXISTS (SELECT 1 FROM json_each(`user_model`.`input_modalities`) WHERE `value` = 'text')
      AND json_array_length(`user_model`.`output_modalities`) = 1
      AND EXISTS (SELECT 1 FROM json_each(`user_model`.`output_modalities`) WHERE `value` = 'text')
    THEN 'audio-transcript'
    ELSE 'text-generation'
  END
)
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
