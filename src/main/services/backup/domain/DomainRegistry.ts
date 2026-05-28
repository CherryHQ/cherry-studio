import { BackupDomain } from '@shared/backup'

export const DOMAIN_TABLE_MAP: Record<BackupDomain, readonly string[]> = {
  [BackupDomain.TOPICS]: ['topic', 'message', 'pin'],
  [BackupDomain.KNOWLEDGE]: ['knowledge_base', 'knowledge_item'],
  [BackupDomain.PREFERENCES]: ['preference'],
  [BackupDomain.MCP_SERVERS]: ['mcp_server'],
  [BackupDomain.TAGS_GROUPS]: ['tag', 'entity_tag', 'group'],
  [BackupDomain.TRANSLATE_HISTORY]: ['translate_language', 'translate_history'],
  [BackupDomain.PROMPTS]: ['prompt'],
  [BackupDomain.FILE_STORAGE]: ['file_entry', 'file_ref'],
  [BackupDomain.PROVIDERS]: ['user_provider', 'user_model'],
  [BackupDomain.MINIAPPS]: ['mini_app'],
  [BackupDomain.ASSISTANTS]: ['assistant', 'assistant_mcp_server', 'assistant_knowledge_base'],
  [BackupDomain.AGENTS]: [
    'agent',
    'agent_global_skill',
    'agent_task',
    'agent_session',
    'agent_channel',
    'agent_skill',
    'agent_channel_task',
    'agent_session_message',
    'agent_task_run_log'
  ],
  [BackupDomain.SKILLS]: []
}

/**
 * Not in any domain and not in INFRASTRUCTURE_TABLES — dropped automatically
 * by the inverse keep-set approach. Exported for documentation and testing.
 */
export const ALWAYS_STRIP_TABLES = ['app_state', 'message_fts', 'job', 'job_schedule'] as const

export const INFRASTRUCTURE_TABLES = ['__drizzle_migrations'] as const

export const IMPORT_ORDER: readonly BackupDomain[] = [
  // Phase 1 — FK-aware restore order: providers must come before domains
  // that reference user_model (knowledge_base, message, assistant)
  BackupDomain.PREFERENCES,
  BackupDomain.PROMPTS,
  BackupDomain.MCP_SERVERS,
  BackupDomain.TAGS_GROUPS,
  BackupDomain.PROVIDERS,
  BackupDomain.KNOWLEDGE,
  BackupDomain.TOPICS,
  BackupDomain.TRANSLATE_HISTORY,
  BackupDomain.FILE_STORAGE,
  // Phase 2
  BackupDomain.ASSISTANTS,
  BackupDomain.AGENTS,
  BackupDomain.MINIAPPS,
  BackupDomain.SKILLS
]

export function getTablesForDomains(domains: BackupDomain[]): string[] {
  return domains.flatMap((d) => DOMAIN_TABLE_MAP[d])
}

export function getTablesKeepSet(selectedDomains: BackupDomain[]): Set<string> {
  const keep = new Set<string>(getTablesForDomains(selectedDomains))
  for (const t of INFRASTRUCTURE_TABLES) keep.add(t)
  return keep
}
