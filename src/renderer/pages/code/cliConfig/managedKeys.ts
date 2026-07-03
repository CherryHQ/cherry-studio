export const CLAUDE_MANAGED_TOP_LEVEL_KEYS = ['attribution', 'permissions'] as const

export const CLAUDE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
  'DISABLE_COMPACT',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'DISABLE_EXTRA_USAGE_COMMAND',
  'CLAUDE_CODE_ATTRIBUTION_HEADER'
] as const

export const CODEX_MANAGED_TOP_LEVEL_KEYS = [
  'model_reasoning_effort',
  'disable_response_storage',
  'personality',
  'model_verbosity',
  'model_context_window',
  'model_auto_compact_token_limit',
  'review_model'
] as const

export const GEMINI_MANAGED_ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'] as const

export const GEMINI_MANAGED_SETTINGS_KEYS = {
  general: ['vimMode', 'preferredEditor', 'defaultApprovalMode', 'checkpointing'] as const,
  ui: ['hideBanner'] as const,
  privacy: ['usageStatisticsEnabled'] as const,
  model: ['maxSessionTurns', 'compressionThreshold'] as const,
  context: ['fileName', 'includeDirectories'] as const,
  tools: ['exclude'] as const,
  advanced: ['excludedEnvVars'] as const
} as const

export const QWEN_MANAGED_SETTINGS_KEYS = {
  general: ['vimMode', 'preferredEditor', 'enableAutoUpdate', 'outputLanguage', 'cleanupPeriodDays'] as const,
  ui: ['hideBanner'] as const,
  privacy: ['usageStatisticsEnabled'] as const,
  tools: ['approvalMode'] as const,
  context: ['fileName'] as const,
  permissions: ['autoMode'] as const
} as const

export const KIMI_MANAGED_TOP_LEVEL_KEYS = [
  'default_permission_mode',
  'default_plan_mode',
  'merge_all_available_skills',
  'telemetry'
] as const

export const KIMI_MANAGED_SECTION_KEYS = {
  thinking: ['enabled', 'effort'] as const,
  loop_control: ['max_steps_per_turn', 'max_retries_per_step', 'reserved_context_size'] as const,
  background: ['max_running_tasks', 'keep_alive_on_exit'] as const,
  experimental: ['micro_compaction'] as const
} as const

export type ManagedSettingsKeys = Record<string, readonly string[]>

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

export function applyManagedJsonSettings(
  target: Record<string, any>,
  source: Record<string, any>,
  managedKeys: ManagedSettingsKeys
): void {
  for (const [section, keys] of Object.entries(managedKeys)) {
    const nextSection = { ...asRecord(target[section]) }
    for (const key of keys) delete nextSection[key]

    const sourceSection = asRecord(source[section])
    for (const key of keys) {
      if (sourceSection[key] !== undefined) nextSection[key] = sourceSection[key]
    }

    if (Object.keys(nextSection).length > 0) target[section] = nextSection
    else delete target[section]
  }
}

export function applyManagedTomlSettings(target: Record<string, any>, source: Record<string, any>): void {
  for (const key of KIMI_MANAGED_TOP_LEVEL_KEYS) {
    delete target[key]
    if (source[key] !== undefined) target[key] = source[key]
  }

  for (const [section, keys] of Object.entries(KIMI_MANAGED_SECTION_KEYS)) {
    const nextSection = { ...asRecord(target[section]) }
    for (const key of keys) delete nextSection[key]

    const sourceSection = asRecord(source[section])
    for (const key of keys) {
      if (sourceSection[key] !== undefined) nextSection[key] = sourceSection[key]
    }

    if (Object.keys(nextSection).length > 0) target[section] = nextSection
    else delete target[section]
  }
}
