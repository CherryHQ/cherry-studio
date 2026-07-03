import { CodeCli } from '@shared/types/codeCli'

import type { CliConfigLanguage, CliConfigTarget } from './types'

export const CLAUDE_SETTINGS_PATH = '~/.claude/settings.json'
export const CODEX_AUTH_PATH = '~/.codex/auth.json'
export const CODEX_CONFIG_PATH = '~/.codex/config.toml'
export const OPENCODE_CONFIG_PATH = '~/.config/opencode/opencode.json'
export const GEMINI_ENV_PATH = '~/.gemini/.env'
export const GEMINI_SETTINGS_PATH = '~/.gemini/settings.json'
export const QWEN_CONFIG_PATH = '~/.qwen/settings.json'
export const KIMI_CONFIG_PATH = '~/.kimi-code/config.toml'

export const CLI_CONFIG_FILE_SPECS: Record<
  CliConfigTarget,
  { label: string; path: string; language: CliConfigLanguage }
> = {
  'claude-settings': { label: 'Claude settings.json', path: CLAUDE_SETTINGS_PATH, language: 'json' },
  'codex-config': { label: 'Codex config.toml', path: CODEX_CONFIG_PATH, language: 'toml' },
  'codex-auth': { label: 'Codex auth.json', path: CODEX_AUTH_PATH, language: 'json' },
  'opencode-config': { label: 'OpenCode opencode.json', path: OPENCODE_CONFIG_PATH, language: 'json' },
  'gemini-env': { label: 'Gemini .env', path: GEMINI_ENV_PATH, language: 'dotenv' },
  'gemini-settings': { label: 'Gemini settings.json', path: GEMINI_SETTINGS_PATH, language: 'json' },
  'qwen-settings': { label: 'Qwen settings.json', path: QWEN_CONFIG_PATH, language: 'json' },
  'kimi-config': { label: 'Kimi config.toml', path: KIMI_CONFIG_PATH, language: 'toml' }
}

export function getCliConfigTargets(cliTool: string): CliConfigTarget[] {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return ['claude-settings']
    case CodeCli.OPENAI_CODEX:
      return ['codex-config', 'codex-auth']
    case CodeCli.OPEN_CODE:
      return ['opencode-config']
    case CodeCli.GEMINI_CLI:
      return ['gemini-env', 'gemini-settings']
    case CodeCli.QWEN_CODE:
      return ['qwen-settings']
    case CodeCli.KIMI_CODE:
      return ['kimi-config']
    default:
      return []
  }
}
