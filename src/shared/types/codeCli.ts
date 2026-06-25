export enum codeCLI {
  // @legacy — removed in v2
  // qwenCode = 'qwen-code',
  // geminiCli = 'gemini-cli',
  // qoderCli = 'qoder-cli',
  // kimiCli = 'kimi-cli',
  // githubCopilotCli = 'github-copilot-cli',

  claudeCode = 'claude-code',
  openaiCodex = 'openai-codex',
  openCode = 'opencode',
  openclaw = 'openclaw',
  hermes = 'hermes'
}

export enum terminalApps {
  systemDefault = 'Terminal',
  iterm2 = 'iTerm2',
  kitty = 'kitty',
  alacritty = 'Alacritty',
  wezterm = 'WezTerm',
  ghostty = 'Ghostty',
  tabby = 'Tabby',
  // Windows terminals
  windowsTerminal = 'WindowsTerminal',
  powershell = 'PowerShell',
  cmd = 'CMD',
  wsl = 'WSL'
}

export interface TerminalConfig {
  id: string
  name: string
  bundleId?: string
  customPath?: string
}

export interface TerminalConfigWithCommand extends TerminalConfig {
  command: (directory: string, fullCommand: string) => { command: string; args: string[] }
}

export type GitBashPathSource = 'manual' | 'auto'

export interface GitBashPathInfo {
  path: string | null
  source: GitBashPathSource | null
}

export type CodexChatThinkingParam = 'none' | 'thinking' | 'enable_thinking' | 'reasoning_split'

export type CodexChatEffortParam = 'none' | 'reasoning_effort' | 'reasoning.effort'

export type CodexChatEffortValueMode = 'passthrough' | 'low_high' | 'deepseek' | 'openrouter'

export type CodexChatReasoningOutputFormat =
  | 'auto'
  | 'reasoning_content'
  | 'reasoning'
  | 'reasoning_details'
  | 'think_tags'

export interface CodexChatReasoning {
  supportsThinking?: boolean
  supportsEffort?: boolean
  thinkingParam?: CodexChatThinkingParam
  effortParam?: CodexChatEffortParam
  effortValueMode?: CodexChatEffortValueMode
  outputFormat?: CodexChatReasoningOutputFormat
}

/**
 * Claude Code provider config (→ ~/.claude/settings.json).
 */
export interface ClaudeProviderConfig {
  baseUrl: string
  model: string
  apiKey?: string
  authToken?: string
  /** ANTHROPIC_DEFAULT_HAIKU_MODEL */
  haikuModel?: string
  /** ANTHROPIC_DEFAULT_SONNET_MODEL */
  sonnetModel?: string
  /** ANTHROPIC_DEFAULT_OPUS_MODEL */
  opusModel?: string
  /** API_TIMEOUT_MS (string) */
  timeoutMs?: string
  /** CLAUDE_CODE_MAX_OUTPUT_TOKENS */
  maxOutputTokens?: string
  /** CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (1 = disabled) */
  disableNonessentialTraffic?: number
  /** CLAUDE_CODE_AUTO_COMPACT_WINDOW */
  autoCompactWindow?: string
  /** CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS */
  disableExperimentalBetas?: string
  /** ENABLE_TOOL_SEARCH */
  enableToolSearch?: boolean
  /** skipWebFetchPreflight */
  skipWebFetchPreflight?: boolean
  /** includeCoAuthoredBy */
  includeCoAuthoredBy?: boolean
  /** Top-level effortLevel (e.g. 'high') */
  effortLevel?: string
  /** Top-level enabledPlugins map */
  enabledPlugins?: Record<string, boolean>
}

/**
 * OpenAI Codex provider config (→ ~/.codex/config.toml + auth.json).
 */
export interface CodexProviderConfig {
  apiKey: string
  baseUrl: string
  providerName: string
  model: string
  /** model_reasoning_effort */
  reasoningEffort?: string
  /** disable_response_storage */
  disableResponseStorage?: boolean
  /** personality (e.g. 'pragmatic') */
  personality?: string
  /** model_verbosity */
  verbosity?: string
  /** model_context_window */
  contextWindow?: number
  /** model_auto_compact_token_limit */
  autoCompactTokenLimit?: number
  /** review_model */
  reviewModel?: string
}

/**
 * OpenCode provider config (→ ~/.config/opencode/opencode.json).
 */
export interface OpenCodeProviderConfig {
  apiKey: string
  baseUrl: string
  providerName: string
  providerType: string
  endpointType: string
  model: string
  modelName: string
  isReasoning: boolean
  supportsReasoningEffort: boolean
  budgetTokens?: number
  /** Per-model context limit (OpenCodeModel.limit.context) */
  contextLimit?: number
  /** Per-model output limit (OpenCodeModel.limit.output) */
  outputLimit?: number
}

/**
 * OpenClaw provider config (→ ~/.openclaw/openclaw.json).
 */
export interface OpenClawProviderConfig {
  apiKey: string
  baseUrl: string
  api: string
  model: string
  modelName: string
  providerName: string
  /** Per-model reasoning flag */
  reasoning?: boolean
  /** Per-model context window */
  contextWindow?: number
  /** Per-model max output tokens */
  maxTokens?: number
  /** Custom request headers */
  headers?: Record<string, string>
}

/**
 * Hermes provider config (→ ~/.hermes/config.yaml).
 */
export interface HermesProviderConfig {
  apiKey: string
  baseUrl: string
  apiMode: string
  model: string
  modelName: string
  providerName: string
  /** Per-model context length */
  contextLength?: number
  /** Per-model max output tokens */
  maxTokens?: number
}

// ── CLI config writer dispatch map ─────────────────────────────────────────

export interface CliProviderConfigMap {
  [codeCLI.claudeCode]: ClaudeProviderConfig
  [codeCLI.openaiCodex]: CodexProviderConfig
  [codeCLI.openCode]: OpenCodeProviderConfig
  [codeCLI.openclaw]: OpenClawProviderConfig
  [codeCLI.hermes]: HermesProviderConfig
}

export type CliProviderConfig = CliProviderConfigMap[keyof CliProviderConfigMap]
