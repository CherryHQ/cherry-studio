export enum codeCLI {
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

// Git Bash path configuration types
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
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  timeoutMs?: string
  maxOutputTokens?: string
  disableNonessentialTraffic?: number
  autoCompactWindow?: string
  disableExperimentalBetas?: string
  enableToolSearch?: boolean
  skipWebFetchPreflight?: boolean
  includeCoAuthoredBy?: boolean
  effortLevel?: string
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
  reasoningEffort?: string
  disableResponseStorage?: boolean
  personality?: string
  verbosity?: string
  contextWindow?: number
  autoCompactTokenLimit?: number
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
  contextLimit?: number
  outputLimit?: number
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
  contextLength?: number
  maxTokens?: number
}

export interface CliProviderConfigMap {
  [codeCLI.claudeCode]: ClaudeProviderConfig
  [codeCLI.openaiCodex]: CodexProviderConfig
  [codeCLI.openCode]: OpenCodeProviderConfig
  [codeCLI.hermes]: HermesProviderConfig
}

export type CliProviderConfig = CliProviderConfigMap[keyof CliProviderConfigMap]
