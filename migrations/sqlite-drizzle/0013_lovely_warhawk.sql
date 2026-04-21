ALTER TABLE `agent_global_skill` ADD `install_source` text;--> statement-breakpoint
ALTER TABLE `agent_global_skill` ADD `origin_key` text;--> statement-breakpoint
UPDATE `agent_global_skill`
SET
  `install_source` = 'clawhub:' || substr(`source_url`, length('https://clawhub.ai/skills/') + 1),
  `origin_key` = 'clawhub:' || substr(`source_url`, length('https://clawhub.ai/skills/') + 1)
WHERE `source_url` LIKE 'https://clawhub.ai/skills/%';--> statement-breakpoint
UPDATE `agent_global_skill`
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
WHERE `source_url` LIKE 'https://github.com/%/tree/main/%';--> statement-breakpoint
WITH `repo_only_skills` AS (
  SELECT
    `id`,
    `folder_name` AS `skill_folder_name`,
    rtrim(replace(`source_url`, 'https://github.com/', ''), '/') AS `repo_path`
  FROM `agent_global_skill`
  WHERE `source` = 'marketplace'
    AND `source_url` LIKE 'https://github.com/%/%'
    AND `source_url` NOT LIKE '%/tree/%'
    AND rtrim(replace(`source_url`, 'https://github.com/', ''), '/') NOT LIKE '%/%/%'
    AND `install_source` IS NULL
)
UPDATE `agent_global_skill`
SET
  `install_source` = (
    SELECT 'skills.sh:' || `repo_path` ||
      CASE
        WHEN `skill_folder_name` = substr(`repo_path`, instr(`repo_path`, '/') + 1) THEN ''
        ELSE '/' || `skill_folder_name`
      END
    FROM `repo_only_skills`
    WHERE `repo_only_skills`.`id` = `agent_global_skill`.`id`
  ),
  `origin_key` = (
    SELECT 'github:' || `repo_path` ||
      CASE
        WHEN `skill_folder_name` = substr(`repo_path`, instr(`repo_path`, '/') + 1) THEN ''
        ELSE '#' || `skill_folder_name`
      END
    FROM `repo_only_skills`
    WHERE `repo_only_skills`.`id` = `agent_global_skill`.`id`
  )
WHERE `id` IN (SELECT `id` FROM `repo_only_skills`);
