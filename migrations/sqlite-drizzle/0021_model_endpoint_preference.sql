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
--> statement-breakpoint
-- The old add-model form stored `[]` for "no input modality chosen". Under the delta contract
-- `[]` means "explicitly cleared", so those rows move to NULL (inherit) — every later `[]` was
-- written with the provenance bit set and keeps its meaning. Then the bit itself goes.
UPDATE `user_model`
SET `input_modalities` = NULL
WHERE `input_modalities` = '[]'
  AND `input_modalities_explicit` = 0;
--> statement-breakpoint
ALTER TABLE `user_model` DROP COLUMN `input_modalities_explicit`;
