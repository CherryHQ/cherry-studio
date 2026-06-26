export interface AdvancedFieldDef {
  labelKey: string
  envKey: string
  type: 'text' | 'number' | 'boolean' | 'select'
  placeholder?: string
  options?: { value: string; labelKey: string }[]
  min?: number
  max?: number
}

export interface ModelRoleFieldDef {
  labelKey: string
  envKey: string
  placeholder: string
}

export const ADVANCED_FIELDS: Record<string, AdvancedFieldDef[]> = {
  'claude-code': [
    {
      envKey: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
      labelKey: 'code.adv.claude.max_output_tokens',
      type: 'text',
      placeholder: '16384'
    },
    {
      envKey: 'CLAUDE_CODE_EFFORT_LEVEL',
      labelKey: 'code.adv.claude.effort_level',
      type: 'select',
      options: [
        { value: 'low', labelKey: 'code.adv.effort.low' },
        { value: 'medium', labelKey: 'code.adv.effort.medium' },
        { value: 'high', labelKey: 'code.adv.effort.high' }
      ]
    },
    {
      envKey: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
      labelKey: 'code.adv.claude.auto_compact_window',
      type: 'text',
      placeholder: '100000'
    },
    { envKey: 'ENABLE_TOOL_SEARCH', labelKey: 'code.adv.claude.enable_tool_search', type: 'boolean' },
    {
      envKey: 'CLAUDE_CODE_SKIP_WEB_FETCH_PREFLIGHT',
      labelKey: 'code.adv.claude.skip_web_fetch_preflight',
      type: 'boolean'
    },
    {
      envKey: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      labelKey: 'code.adv.claude.disable_nonessential_traffic',
      type: 'boolean'
    },
    {
      envKey: 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
      labelKey: 'code.adv.claude.disable_experimental_betas',
      type: 'boolean'
    }
  ],
  'openai-codex': [
    {
      envKey: 'CODEX_REASONING_EFFORT',
      labelKey: 'code.adv.codex.reasoning_effort',
      type: 'select',
      options: [
        { value: 'low', labelKey: 'code.adv.effort.low' },
        { value: 'medium', labelKey: 'code.adv.effort.medium' },
        { value: 'high', labelKey: 'code.adv.effort.high' }
      ]
    },
    { envKey: 'CODEX_PERSONALITY', labelKey: 'code.adv.codex.personality', type: 'text', placeholder: 'pragmatic' },
    { envKey: 'CODEX_VERBOSITY', labelKey: 'code.adv.codex.verbosity', type: 'text', placeholder: 'concise' },
    {
      envKey: 'CODEX_CONTEXT_WINDOW',
      labelKey: 'code.adv.codex.context_window',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      envKey: 'CODEX_AUTO_COMPACT_TOKEN_LIMIT',
      labelKey: 'code.adv.codex.auto_compact_token_limit',
      type: 'number',
      placeholder: '100000',
      min: 1000,
      max: 1000000
    },
    { envKey: 'CODEX_REVIEW_MODEL', labelKey: 'code.adv.codex.review_model', type: 'text', placeholder: 'gpt-4o' },
    { envKey: 'CODEX_DISABLE_RESPONSE_STORAGE', labelKey: 'code.adv.codex.disable_response_storage', type: 'boolean' }
  ],
  opencode: [
    {
      envKey: 'OPENCODE_BUDGET_TOKENS',
      labelKey: 'code.adv.opencode.budget_tokens',
      type: 'number',
      placeholder: '10000',
      min: 1000,
      max: 100000
    },
    {
      envKey: 'OPENCODE_CONTEXT_LIMIT',
      labelKey: 'code.adv.opencode.context_limit',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      envKey: 'OPENCODE_OUTPUT_LIMIT',
      labelKey: 'code.adv.opencode.output_limit',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ],
  openclaw: [
    { envKey: 'OPENCLAW_REASONING', labelKey: 'code.adv.openclaw.reasoning', type: 'boolean' },
    {
      envKey: 'OPENCLAW_CONTEXT_WINDOW',
      labelKey: 'code.adv.openclaw.context_window',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      envKey: 'OPENCLAW_MAX_TOKENS',
      labelKey: 'code.adv.openclaw.max_tokens',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ],
  hermes: [
    {
      envKey: 'HERMES_CONTEXT_LENGTH',
      labelKey: 'code.adv.hermes.context_length',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      envKey: 'HERMES_MAX_TOKENS',
      labelKey: 'code.adv.hermes.max_tokens',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ]
}

export const MODEL_ROLE_FIELDS: Record<string, ModelRoleFieldDef[]> = {
  'claude-code': [
    {
      envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      labelKey: 'code.adv.claude.haiku_model',
      placeholder: 'claude-haiku-4-5'
    },
    {
      envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      labelKey: 'code.adv.claude.sonnet_model',
      placeholder: 'claude-sonnet-4-5'
    },
    { envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL', labelKey: 'code.adv.claude.opus_model', placeholder: 'claude-opus-4-1' }
  ]
}
