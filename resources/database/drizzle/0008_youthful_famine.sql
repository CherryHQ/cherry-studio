ALTER TABLE `skills` ADD `install_source` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_key` text;
--> statement-breakpoint
UPDATE `skills`
SET
  `install_source` = 'clawhub:' || substr(`source_url`, length('https://clawhub.ai/skills/') + 1),
  `origin_key` = 'clawhub:' || substr(`source_url`, length('https://clawhub.ai/skills/') + 1)
WHERE `source_url` LIKE 'https://clawhub.ai/skills/%';
--> statement-breakpoint
UPDATE `skills`
SET
  `install_source` = 'claude-plugins:'
    || substr(replace(`source_url`, 'https://github.com/', ''), 1, instr(replace(`source_url`, 'https://github.com/', ''), '/tree/main/') - 1)
    || '/'
    || substr(replace(`source_url`, 'https://github.com/', ''), instr(replace(`source_url`, 'https://github.com/', ''), '/tree/main/') + length('/tree/main/')),
  `origin_key` = 'github:'
    || substr(replace(`source_url`, 'https://github.com/', ''), 1, instr(replace(`source_url`, 'https://github.com/', ''), '/tree/main/') - 1)
    || CASE
      WHEN substr(replace(`source_url`, 'https://github.com/', ''), instr(replace(`source_url`, 'https://github.com/', ''), '/tree/main/') + length('/tree/main/')) = '' THEN ''
      ELSE '#' || substr(replace(`source_url`, 'https://github.com/', ''), instr(replace(`source_url`, 'https://github.com/', ''), '/tree/main/') + length('/tree/main/'))
    END
WHERE `source_url` LIKE 'https://github.com/%/tree/main/%';
