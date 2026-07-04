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

/**
 * The config files each file-based CLI tool owns. Single source of truth for
 * both "which tools write config files" (`FILE_CONFIGURED_CLI_TOOLS`) and "which
 * files" (`getCliConfigTargets`) — the two used to be separate lists that had to
 * be kept in sync by hand.
 */
const CLI_CONFIG_TARGETS = {
  [CodeCli.CLAUDE_CODE]: ['claude-settings'],
  [CodeCli.OPENAI_CODEX]: ['codex-config', 'codex-auth'],
  [CodeCli.OPEN_CODE]: ['opencode-config'],
  [CodeCli.GEMINI_CLI]: ['gemini-env', 'gemini-settings'],
  [CodeCli.QWEN_CODE]: ['qwen-settings'],
  [CodeCli.KIMI_CODE]: ['kimi-config']
} as const satisfies Partial<Record<CodeCli, readonly CliConfigTarget[]>>

/** CLI tools that write on-disk config files (the ones with targets above). */
export const FILE_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set(Object.keys(CLI_CONFIG_TARGETS))

export function getCliConfigTargets(cliTool: string): readonly CliConfigTarget[] {
  return CLI_CONFIG_TARGETS[cliTool as keyof typeof CLI_CONFIG_TARGETS] ?? []
}
