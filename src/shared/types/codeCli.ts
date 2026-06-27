export enum codeCLI {
  claudeCode = 'claude-code',
  openaiCodex = 'openai-codex',
  openCode = 'opencode',
  openclaw = 'openclaw',
  hermes = 'hermes'
}

export enum TerminalApp {
  SYSTEM_DEFAULT = 'Terminal',
  ITERM2 = 'iTerm2',
  KITTY = 'kitty',
  ALACRITTY = 'Alacritty',
  WEZTERM = 'WezTerm',
  GHOSTTY = 'Ghostty',
  TABBY = 'Tabby',
  // Windows terminals
  WINDOWS_TERMINAL = 'WindowsTerminal',
  POWERSHELL = 'PowerShell',
  CMD = 'CMD',
  WSL = 'WSL'
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
