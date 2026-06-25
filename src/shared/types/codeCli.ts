export enum codeCLI {
  qwenCode = 'qwen-code',
  claudeCode = 'claude-code',
  geminiCli = 'gemini-cli',
  openaiCodex = 'openai-codex',
  qoderCli = 'qoder-cli',
  githubCopilotCli = 'github-copilot-cli',
  kimiCli = 'kimi-cli',
  openCode = 'opencode'
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

export interface GeminiProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface QwenProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface KimiProviderConfig {
  apiKey: string
  model: string
  baseUrl?: string
  providerType?: string
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
  [codeCLI.geminiCli]: GeminiProviderConfig
  [codeCLI.qwenCode]: QwenProviderConfig
  [codeCLI.kimiCli]: KimiProviderConfig
  [codeCLI.openCode]: OpenCodeProviderConfig
}

export type CliProviderConfig = CliProviderConfigMap[keyof CliProviderConfigMap]
