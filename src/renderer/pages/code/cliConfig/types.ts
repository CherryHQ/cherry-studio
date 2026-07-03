export type CliConfigTarget =
  | 'claude-settings'
  | 'codex-config'
  | 'codex-auth'
  | 'opencode-config'
  | 'gemini-env'
  | 'gemini-settings'
  | 'qwen-settings'
  | 'kimi-config'

export type CliConfigLanguage = 'json' | 'toml' | 'dotenv'

export interface CliConfigFileDraft {
  target: CliConfigTarget
  label: string
  path: string
  language: CliConfigLanguage
  content: string
}

export interface CliConfigConnection {
  baseUrl?: string
  apiKey?: string
  model?: string
}
