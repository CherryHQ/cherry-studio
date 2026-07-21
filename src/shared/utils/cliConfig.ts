import { CodeCli } from '@shared/types/codeCli'

/**
 * The on-disk config-file surface of the file-configured Code CLIs.
 * Cross-process single source of truth: the renderer builds drafts and labels
 * from it; main validates and resolves `code_cli.write_config` targets against
 * it — the target-id enum below is the write allow-list, so the renderer never
 * sends a path over IPC.
 */

export const CLI_CONFIG_TARGET_IDS = [
  'claude-settings',
  'codex-config',
  'codex-auth',
  'opencode-config',
  'gemini-env',
  'gemini-settings',
  'qwen-settings',
  'kimi-config'
] as const

export type CliConfigTarget = (typeof CLI_CONFIG_TARGET_IDS)[number]

export type CliConfigLanguage = 'json' | 'toml' | 'dotenv'

/** One file rewrite sent over `code_cli.write_config`. */
export interface CliConfigWriteFile {
  target: CliConfigTarget
  content: string
}

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

/** The file-based CLI tools, as a tuple so IPC schemas can `z.enum` it. */
export const FILE_CONFIGURED_CLI_TOOL_IDS = [
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.OPEN_CODE,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
] as const

export type FileConfiguredCli = (typeof FILE_CONFIGURED_CLI_TOOL_IDS)[number]

/**
 * The config files each file-based CLI tool owns. Single source of truth for
 * both "which tools write config files" (`FILE_CONFIGURED_CLI_TOOLS`) and "which
 * files" (`getCliConfigTargets`) — the two used to be separate lists that had to
 * be kept in sync by hand.
 */
const CLI_CONFIG_TARGETS: Record<FileConfiguredCli, readonly CliConfigTarget[]> = {
  [CodeCli.CLAUDE_CODE]: ['claude-settings'],
  [CodeCli.OPENAI_CODEX]: ['codex-config', 'codex-auth'],
  [CodeCli.OPEN_CODE]: ['opencode-config'],
  [CodeCli.GEMINI_CLI]: ['gemini-env', 'gemini-settings'],
  [CodeCli.QWEN_CODE]: ['qwen-settings'],
  [CodeCli.KIMI_CODE]: ['kimi-config']
}

/** CLI tools that write on-disk config files (the ones with targets above). */
export const FILE_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set(FILE_CONFIGURED_CLI_TOOL_IDS)

export function isFileConfiguredCli(cliTool: string): cliTool is FileConfiguredCli {
  return FILE_CONFIGURED_CLI_TOOLS.has(cliTool)
}

export function getCliConfigTargets(cliTool: string): readonly CliConfigTarget[] {
  return isFileConfiguredCli(cliTool) ? CLI_CONFIG_TARGETS[cliTool] : []
}
