CREATE TABLE `agent_task_session` (
	`session_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `agent_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `job_schedule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_task_session_task_id_idx` ON `agent_task_session` (`task_id`);--> statement-breakpoint
INSERT INTO `agent_task_session` (`session_id`, `task_id`)
SELECT `agent_session`.`id`, `agent_session`.`task_schedule_id`
FROM `agent_session`
INNER JOIN `job_schedule` ON `job_schedule`.`id` = `agent_session`.`task_schedule_id`
WHERE `agent_session`.`task_schedule_id` IS NOT NULL
	AND `job_schedule`.`type` = 'agent.task';
--> statement-breakpoint
WITH `task_job_sessions` AS (
	SELECT
		`job`.`schedule_id` AS `task_id`,
		CASE
			WHEN json_valid(`job`.`output`) THEN json_extract(`job`.`output`, '$.sessionId')
			ELSE NULL
		END AS `session_id`
	FROM `job`
	WHERE `job`.`type` = 'agent.task'
		AND `job`.`schedule_id` IS NOT NULL
)
INSERT OR IGNORE INTO `agent_task_session` (`session_id`, `task_id`)
SELECT DISTINCT `task_job_sessions`.`session_id`, `task_job_sessions`.`task_id`
FROM `task_job_sessions`
INNER JOIN `job_schedule` ON `job_schedule`.`id` = `task_job_sessions`.`task_id`
INNER JOIN `agent_session` ON `agent_session`.`id` = `task_job_sessions`.`session_id`
WHERE `job_schedule`.`type` = 'agent.task'
	AND typeof(`task_job_sessions`.`session_id`) = 'text';
