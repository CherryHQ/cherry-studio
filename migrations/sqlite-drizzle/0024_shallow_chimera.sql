CREATE TABLE `agent_knowledge_base` (
	`agent_id` text NOT NULL,
	`knowledge_base_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `knowledge_base_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade
);
