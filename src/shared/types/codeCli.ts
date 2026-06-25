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
  customPath?: string // For user-configured terminal paths on Windows
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

// Typed provider configs written to each file-based CLI's own config file
export interface ClaudeProviderConfig {
  baseUrl: string
  model: string
  apiKey?: string
  authToken?: string
}

export interface CodexProviderConfig {
  apiKey: string
  baseUrl: string
  providerName: string
  model: string
}

// @legacy — removed in v2
// export interface QwenProviderConfig { apiKey, baseUrl, model }
// export interface GeminiProviderConfig { apiKey, baseUrl, model }
// export interface KimiProviderConfig { apiKey, model, baseUrl?, providerType? }

export interface OpenClawProviderConfig {
  apiKey: string
  baseUrl: string
  api: string
  model: string
  modelName: string
  providerName: string
}

export interface HermesProviderConfig {
  apiKey: string
  baseUrl: string
  apiMode: string
  model: string
  modelName: string
  providerName: string
}

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
}

export interface CliProviderConfigMap {
  [codeCLI.claudeCode]: ClaudeProviderConfig
  [codeCLI.openaiCodex]: CodexProviderConfig
  [codeCLI.openCode]: OpenCodeProviderConfig
  [codeCLI.openclaw]: OpenClawProviderConfig
  [codeCLI.hermes]: HermesProviderConfig
}

export type CliProviderConfig = CliProviderConfigMap[keyof CliProviderConfigMap]
