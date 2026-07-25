import { asRecord } from './values'

export const CLAUDE_MANAGED_TOP_LEVEL_KEYS = ['attribution', 'effortLevel'] as const

export const CLAUDE_MANAGED_PERMISSION_KEYS = ['defaultMode'] as const

export const CLAUDE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  // Cherry writes ANTHROPIC_AUTH_TOKEN, never ANTHROPIC_API_KEY — but the key
  // stays managed so a stale/user-set API key gets scrubbed on apply. If both
  // are present Claude Code prefers ANTHROPIC_API_KEY, which would silently
  // shadow the injected token (#15089).
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
  'CLAUDE_CODE_SUBAGENT_MODEL',
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
  'approval_policy',
  'sandbox_mode',
  'default_permissions',
  'model_reasoning_effort',
  'disable_response_storage',
  'personality',
  'model_verbosity',
  'model_context_window',
  'model_auto_compact_token_limit',
  'review_model'
] as const

export const OPEN_CODE_MANAGED_TOP_LEVEL_KEYS = ['autoCompact', 'maxTurns', 'permission'] as const

export const OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS = ['autoCompact', 'permissionMode'] as const

export const GEMINI_MANAGED_ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'] as const

export const GEMINI_WRITABLE_SETTINGS_KEYS = {
  general: ['vimMode', 'checkpointing', 'defaultApprovalMode'] as const,
  ui: ['hideBanner'] as const,
  privacy: ['usageStatisticsEnabled'] as const
} as const

export const GEMINI_MANAGED_SETTINGS_KEYS = mergeManagedSettingsKeys(GEMINI_WRITABLE_SETTINGS_KEYS, {
  general: ['preferredEditor'] as const,
  model: ['maxSessionTurns', 'compressionThreshold'] as const,
  context: ['fileName', 'includeDirectories'] as const,
  tools: ['exclude'] as const,
  advanced: ['excludedEnvVars'] as const
})

export const QWEN_WRITABLE_SETTINGS_KEYS = {
  general: ['vimMode', 'enableAutoUpdate'] as const,
  ui: ['hideBanner'] as const,
  privacy: ['usageStatisticsEnabled'] as const,
  tools: ['approvalMode'] as const,
  permissions: ['autoMode'] as const
} as const

export const QWEN_MANAGED_SETTINGS_KEYS = mergeManagedSettingsKeys(QWEN_WRITABLE_SETTINGS_KEYS, {
  general: ['preferredEditor', 'outputLanguage', 'cleanupPeriodDays'] as const,
  context: ['fileName'] as const
})

export const KIMI_WRITABLE_TOP_LEVEL_KEYS = [
  'default_permission_mode',
  'default_plan_mode',
  'merge_all_available_skills',
  'telemetry'
] as const

export const KIMI_MANAGED_TOP_LEVEL_KEYS = KIMI_WRITABLE_TOP_LEVEL_KEYS

export const KIMI_WRITABLE_SECTION_KEYS = {
  thinking: ['enabled'] as const,
  background: ['keep_alive_on_exit'] as const,
  experimental: ['micro_compaction'] as const
} as const

export const KIMI_MANAGED_SECTION_KEYS = mergeManagedSettingsKeys(KIMI_WRITABLE_SECTION_KEYS, {
  thinking: ['enabled', 'effort'] as const,
  loop_control: ['max_steps_per_turn', 'max_retries_per_step', 'reserved_context_size'] as const,
  background: ['max_running_tasks', 'keep_alive_on_exit'] as const,
  experimental: ['micro_compaction'] as const
})

export type ManagedSettingsKeys = Record<string, readonly string[]>

export function mergeManagedSettingsKeys(...groups: ManagedSettingsKeys[]): ManagedSettingsKeys {
  const merged: Record<string, string[]> = {}
  for (const group of groups) {
    for (const [section, keys] of Object.entries(group)) {
      merged[section] = [...new Set([...(merged[section] ?? []), ...keys])]
    }
  }
  return merged
}

export function applyManagedJsonSettings(
  target: Record<string, any>,
  source: Record<string, any>,
  managedKeys: ManagedSettingsKeys,
  topLevelKeys: readonly string[] = []
): void {
  for (const key of topLevelKeys) {
    delete target[key]
    if (source[key] !== undefined) target[key] = source[key]
  }

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

/** Kimi's TOML config adds managed top-level keys on top of the section merge. */
export function applyManagedTomlSettings(target: Record<string, any>, source: Record<string, any>): void {
  applyManagedJsonSettings(target, source, KIMI_MANAGED_SECTION_KEYS, KIMI_MANAGED_TOP_LEVEL_KEYS)
}

/** Kimi's TOML config build path: only clears/restores the WRITABLE subset (unlike clear.ts's full wipe). */
export function applyWritableTomlSettings(target: Record<string, any>, source: Record<string, any>): void {
  applyManagedJsonSettings(target, source, KIMI_WRITABLE_SECTION_KEYS, KIMI_WRITABLE_TOP_LEVEL_KEYS)
}
