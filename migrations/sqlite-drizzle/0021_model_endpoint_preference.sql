ALTER TABLE `user_model` ADD `preferred_endpoint_type` text;
--> statement-breakpoint
WITH `endpoint_operations` (`endpoint`, `operation`) AS (VALUES
  ('anthropic-messages', 'text-generation'),
  ('google-generate-content', 'text-generation'),
  ('jina-rerank', 'rerank'),
  ('ollama-chat', 'text-generation'),
  ('ollama-generate', 'text-generation'),
  ('openai-audio-transcription', 'audio-transcript'),
  ('openai-audio-translation', 'audio-transcript'),
  ('openai-chat-completions', 'text-generation'),
  ('openai-embeddings', 'embedding'),
  ('openai-image-edit', 'image-generation'),
  ('openai-image-generation', 'image-generation'),
  ('openai-responses', 'text-generation'),
  ('openai-text-completions', 'text-generation'),
  ('openai-text-to-speech', 'audio-generation'),
  ('openai-video-generation', 'video-generation')
)
UPDATE `user_model`
SET `capabilities` = (
  SELECT json_group_array(`value`) FROM (
    SELECT `value` FROM json_each(`user_model`.`capabilities`)
    UNION ALL
    SELECT `value` FROM json_each(COALESCE(
      (
        SELECT json_group_array(DISTINCT `operation`)
        FROM json_each(`user_model`.`endpoint_types`) AS `declared`
        JOIN `endpoint_operations` ON `endpoint` = `declared`.`value`
        HAVING count(*) > 0
      ),
      json_array(CASE
        WHEN EXISTS (SELECT 1 FROM json_each(`user_model`.`input_modalities`) WHERE `value` = 'audio')
          AND NOT EXISTS (SELECT 1 FROM json_each(`user_model`.`input_modalities`) WHERE `value` = 'text')
          AND json_array_length(`user_model`.`output_modalities`) = 1
          AND EXISTS (SELECT 1 FROM json_each(`user_model`.`output_modalities`) WHERE `value` = 'text')
        THEN 'audio-transcript'
        ELSE 'text-generation'
      END)
    ))
  )
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
-- Only flagged empty lists represent explicit clearing; the old form's implicit empties
-- must return to inheritance before the provenance bit is removed.
UPDATE `user_model`
SET `input_modalities` = NULL
WHERE `input_modalities` = '[]'
  AND `input_modalities_explicit` = 0;
--> statement-breakpoint
ALTER TABLE `user_model` DROP COLUMN `input_modalities_explicit`;
