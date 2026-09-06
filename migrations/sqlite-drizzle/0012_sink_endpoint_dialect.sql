-- Move provider-wide dialect deviations onto their OpenAI text endpoints.
-- `stream_options` is chat-only; developer-role also applies to Responses.
UPDATE `user_provider`
SET `endpoint_configs` = json_set(
  COALESCE(CASE WHEN json_valid(`endpoint_configs`) THEN `endpoint_configs` END, json_object()),
  '$."openai-chat-completions"',
  json_patch(
    COALESCE(
      json_extract(
        CASE WHEN json_valid(`endpoint_configs`) THEN `endpoint_configs` END,
        '$."openai-chat-completions"'
      ),
      json_object()
    ),
    json_object(
      'dialect',
      json_patch(
        CASE
          WHEN json_extract(`api_features`, '$.streamOptions') IS NULL THEN json_object()
          ELSE json_object('streamOptions', json(CASE WHEN json_extract(`api_features`, '$.streamOptions') THEN 'true' ELSE 'false' END))
        END,
        CASE
          WHEN json_extract(`api_features`, '$.developerRole') IS NULL THEN json_object()
          ELSE json_object('developerRole', json(CASE WHEN json_extract(`api_features`, '$.developerRole') THEN 'true' ELSE 'false' END))
        END
      )
    )
  )
)
WHERE json_valid(`api_features`)
  AND (
    json_type(`endpoint_configs`, '$."openai-chat-completions"') = 'object'
    OR `default_chat_endpoint` = 'openai-chat-completions'
  )
  AND (
    json_extract(`api_features`, '$.streamOptions') IS NOT NULL
    OR json_extract(`api_features`, '$.developerRole') IS NOT NULL
  );
--> statement-breakpoint
UPDATE `user_provider`
SET `endpoint_configs` = json_set(
  COALESCE(CASE WHEN json_valid(`endpoint_configs`) THEN `endpoint_configs` END, json_object()),
  '$."openai-responses"',
  json_patch(
    COALESCE(
      json_extract(
        CASE WHEN json_valid(`endpoint_configs`) THEN `endpoint_configs` END,
        '$."openai-responses"'
      ),
      json_object()
    ),
    json_object(
      'dialect',
      json_patch(
        COALESCE(
          json_extract(
            CASE WHEN json_valid(`endpoint_configs`) THEN `endpoint_configs` END,
            '$."openai-responses".dialect'
          ),
          json_object()
        ),
        json_object(
          'developerRole',
          json(CASE WHEN json_extract(`api_features`, '$.developerRole') THEN 'true' ELSE 'false' END)
        )
      )
    )
  )
)
WHERE json_valid(`api_features`)
  AND json_extract(`api_features`, '$.developerRole') IS NOT NULL
  AND (
    json_type(`endpoint_configs`, '$."openai-responses"') = 'object'
    OR `default_chat_endpoint` = 'openai-responses'
  );
--> statement-breakpoint
ALTER TABLE `user_provider` DROP COLUMN `api_features`;
