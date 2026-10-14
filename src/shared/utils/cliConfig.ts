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
  'qwen-settings',
  'kimi-config',
  'pi-models',
  'pi-settings',
  'hermes-config',
  'hermes-env',
  'minimax-config',
  'codebuddy-settings',
  'codebuddy-models',
  'copilot-settings',
  'copilot-mcp',
  'copilot-providers',
  'cursor-config',
  'cursor-mcp',
  'kiro-settings',
  'kiro-mcp',
  'qoder-settings',
  'kilo-config',
  'goose-config',
  'auggie-settings',
  'junie-config',
  'factory-settings',
  'devin-config',
  'devin-mcp',
  'vibe-config',
  'vibe-env',
  'amp-settings',
  'grok-config',
  'cortex-settings',
  'cortex-mcp',
  'cortex-permissions',
  'stakpak-config',
  'cline-settings',
  'cline-providers',
  'cline-mcp',
  'antigravity-settings',
  'trae-config',
  'fast-agent-config',
  'vtcode-config',
  'poolside-settings'
] as const

export type CliConfigTarget = (typeof CLI_CONFIG_TARGET_IDS)[number]

export type CliConfigLanguage = 'json' | 'toml' | 'dotenv' | 'yaml'

/** One transactional file mutation sent over `code_cli.write_config`. */
export type CliConfigWriteFile =
  | { target: CliConfigTarget; content: string; delete?: never }
  | { target: 'codex-auth'; delete: true; content?: never }

export const CLAUDE_SETTINGS_PATH = '~/.claude/settings.json'
export const CODEX_AUTH_PATH = '~/.codex/auth.json'
export const CODEX_CONFIG_PATH = '~/.codex/config.toml'
export const OPENCODE_CONFIG_PATH = '~/.config/opencode/opencode.json'
export const QWEN_CONFIG_PATH = '~/.qwen/settings.json'
export const KIMI_CONFIG_PATH = '~/.kimi-code/config.toml'
export const PI_MODELS_PATH = '~/.pi/agent/models.json'
export const PI_SETTINGS_PATH = '~/.pi/agent/settings.json'

// Unlike the `~/…` paths above, these are relative to the runtime-resolved Hermes
// home (HERMES_HOME or platform default) — see `pathBase: 'hermes-home'` below.
export const HERMES_CONFIG_PATH = 'config.yaml'
export const HERMES_ENV_PATH = '.env'
export const MINIMAX_CONFIG_PATH = '~/.minimax/config.yaml'

export const CLI_CONFIG_FILE_SPECS: Record<
  CliConfigTarget,
  { label: string; path: string; language: CliConfigLanguage; pathBase?: 'hermes-home' }
> = {
  'copilot-settings': { label: 'Copilot settings.json', path: '~/.copilot/settings.json', language: 'json' },
  'copilot-mcp': { label: 'Copilot mcp-config.json', path: '~/.copilot/mcp-config.json', language: 'json' },
  'copilot-providers': { label: 'Copilot providers.json', path: '~/.copilot/providers.json', language: 'json' },
  'cursor-config': { label: 'Cursor cli-config.json', path: '~/.cursor/cli-config.json', language: 'json' },
  'cursor-mcp': { label: 'Cursor mcp.json', path: '~/.cursor/mcp.json', language: 'json' },
  'kiro-settings': { label: 'Kiro cli.json', path: '~/.kiro/settings/cli.json', language: 'json' },
  'kiro-mcp': { label: 'Kiro mcp.json', path: '~/.kiro/settings/mcp.json', language: 'json' },
  'qoder-settings': { label: 'Qoder settings.json', path: '~/.qoder/settings.json', language: 'json' },
  'kilo-config': { label: 'Kilo kilo.jsonc', path: '~/.config/kilo/kilo.jsonc', language: 'json' },
  'goose-config': { label: 'goose config.yaml', path: '~/.config/goose/config.yaml', language: 'yaml' },
  'auggie-settings': { label: 'Auggie settings.json', path: '~/.augment/settings.json', language: 'json' },
  'junie-config': { label: 'Junie config.json', path: '~/.junie/config.json', language: 'json' },
  'factory-settings': { label: 'Factory settings.json', path: '~/.factory/settings.json', language: 'json' },
  'devin-config': { label: 'Devin config.json', path: '~/.config/devin/config.json', language: 'json' },
  'devin-mcp': { label: 'Devin mcp_config.json', path: '~/.config/devin/mcp_config.json', language: 'json' },
  'vibe-config': { label: 'Vibe config.toml', path: '~/.vibe/config.toml', language: 'toml' },
  'vibe-env': { label: 'Vibe .env', path: '~/.vibe/.env', language: 'dotenv' },
  'amp-settings': { label: 'Amp settings.json', path: '~/.config/amp/settings.json', language: 'json' },
  'grok-config': { label: 'Grok config.toml', path: '~/.grok/config.toml', language: 'toml' },
  'cortex-settings': { label: 'Cortex settings.json', path: '~/.snowflake/cortex/settings.json', language: 'json' },
  'cortex-mcp': { label: 'Cortex mcp.json', path: '~/.snowflake/cortex/mcp.json', language: 'json' },
  'cortex-permissions': {
    label: 'Cortex permissions.json',
    path: '~/.snowflake/cortex/permissions.json',
    language: 'json'
  },
  'stakpak-config': { label: 'Stakpak config.toml', path: '~/.stakpak/config.toml', language: 'toml' },
  'cline-settings': {
    label: 'Cline global-settings.json',
    path: '~/.cline/data/settings/global-settings.json',
    language: 'json'
  },
  'cline-providers': { label: 'Cline providers.json', path: '~/.cline/data/settings/providers.json', language: 'json' },
  'cline-mcp': {
    label: 'Cline cline_mcp_settings.json',
    path: '~/.cline/data/settings/cline_mcp_settings.json',
    language: 'json'
  },
  'antigravity-settings': {
    label: 'Antigravity settings.json',
    path: '~/.gemini/antigravity-cli/settings.json',
    language: 'json'
  },
  'trae-config': { label: 'Trae trae_cli.yaml', path: '~/.config/trae_cli/trae_cli.yaml', language: 'yaml' },
  'fast-agent-config': { label: 'fast-agent.yaml', path: '~/.fast-agent/fast-agent.yaml', language: 'yaml' },
  'vtcode-config': { label: 'VT Code vtcode.toml', path: '~/.config/vtcode/vtcode.toml', language: 'toml' },
  'poolside-settings': { label: 'Poolside settings.yaml', path: '~/.config/poolside/settings.yaml', language: 'yaml' },
  'claude-settings': { label: 'Claude settings.json', path: CLAUDE_SETTINGS_PATH, language: 'json' },
  'codex-config': { label: 'Codex config.toml', path: CODEX_CONFIG_PATH, language: 'toml' },
  'codex-auth': { label: 'Codex auth.json', path: CODEX_AUTH_PATH, language: 'json' },
  'opencode-config': { label: 'OpenCode opencode.json', path: OPENCODE_CONFIG_PATH, language: 'json' },
  'qwen-settings': { label: 'Qwen settings.json', path: QWEN_CONFIG_PATH, language: 'json' },
  'kimi-config': { label: 'Kimi config.toml', path: KIMI_CONFIG_PATH, language: 'toml' },
  'pi-models': { label: 'Pi models.json', path: PI_MODELS_PATH, language: 'json' },
  'pi-settings': { label: 'Pi settings.json', path: PI_SETTINGS_PATH, language: 'json' },
  'hermes-config': {
    label: 'Hermes config.yaml',
    pathBase: 'hermes-home',
    path: HERMES_CONFIG_PATH,
    language: 'yaml'
  },
  'hermes-env': { label: 'Hermes .env', pathBase: 'hermes-home', path: HERMES_ENV_PATH, language: 'dotenv' },
  'minimax-config': { label: 'MiniMax Code config.yaml', path: MINIMAX_CONFIG_PATH, language: 'yaml' },
  'codebuddy-models': { label: 'CodeBuddy models.json', path: '~/.codebuddy/models.json', language: 'json' },
  'codebuddy-settings': { label: 'CodeBuddy settings.json', path: '~/.codebuddy/settings.json', language: 'json' }
}

/** The file-based CLI tools, as a tuple so IPC schemas can `z.enum` it. */
export const MODEL_CONFIGURED_CLI_TOOL_IDS = [
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.OPEN_CODE,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE,
  CodeCli.PI,
  CodeCli.HERMES,
  CodeCli.MINIMAX_CODE,
  'codebuddy-code'
] as const

export type ModelConfiguredCli = (typeof MODEL_CONFIGURED_CLI_TOOL_IDS)[number]

export const FILE_CONFIGURED_CLI_TOOL_IDS = [
  ...MODEL_CONFIGURED_CLI_TOOL_IDS,
  CodeCli.GITHUB_COPILOT_CLI,
  'cursor',
  'kiro',
  CodeCli.QODER_CLI,
  'kilo',
  'goose',
  'auggie',
  'junie',
  'factory-droid',
  'devin',
  'mistral-vibe',
  'amp-acp',
  'grok-build',
  'cortex-code',
  'stakpak',
  'cline',
  CodeCli.ANTIGRAVITY_CLI,
  'trae',
  'fast-agent',
  'vtcode',
  'poolside'
] as const

export type FileConfiguredCli = (typeof FILE_CONFIGURED_CLI_TOOL_IDS)[number]

/**
 * The config files each file-based CLI tool owns. Single source of truth for
 * both "which tools write config files" (`FILE_CONFIGURED_CLI_TOOLS`) and "which
 * files" (`getCliConfigTargets`) — the two used to be separate lists that had to
 * be kept in sync by hand.
 */
const CLI_CONFIG_TARGETS: Record<FileConfiguredCli, readonly CliConfigTarget[]> = {
  [CodeCli.GITHUB_COPILOT_CLI]: ['copilot-settings', 'copilot-mcp', 'copilot-providers'],
  cursor: ['cursor-config', 'cursor-mcp'],
  kiro: ['kiro-settings', 'kiro-mcp'],
  [CodeCli.QODER_CLI]: ['qoder-settings'],
  kilo: ['kilo-config'],
  goose: ['goose-config'],
  auggie: ['auggie-settings'],
  junie: ['junie-config'],
  'factory-droid': ['factory-settings'],
  devin: ['devin-config', 'devin-mcp'],
  'mistral-vibe': ['vibe-config', 'vibe-env'],
  'amp-acp': ['amp-settings'],
  'grok-build': ['grok-config'],
  'cortex-code': ['cortex-settings', 'cortex-mcp', 'cortex-permissions'],
  stakpak: ['stakpak-config'],
  cline: ['cline-settings', 'cline-providers', 'cline-mcp'],
  [CodeCli.ANTIGRAVITY_CLI]: ['antigravity-settings'],
  trae: ['trae-config'],
  'fast-agent': ['fast-agent-config'],
  vtcode: ['vtcode-config'],
  poolside: ['poolside-settings'],
  [CodeCli.CLAUDE_CODE]: ['claude-settings'],
  [CodeCli.OPENAI_CODEX]: ['codex-config', 'codex-auth'],
  [CodeCli.OPEN_CODE]: ['opencode-config'],
  [CodeCli.QWEN_CODE]: ['qwen-settings'],
  [CodeCli.KIMI_CODE]: ['kimi-config'],
  [CodeCli.PI]: ['pi-models', 'pi-settings'],
  [CodeCli.HERMES]: ['hermes-config', 'hermes-env'],
  [CodeCli.MINIMAX_CODE]: ['minimax-config'],
  'codebuddy-code': ['codebuddy-settings', 'codebuddy-models']
}

/** CLI tools that write on-disk config files (the ones with targets above). */
export const FILE_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set(FILE_CONFIGURED_CLI_TOOL_IDS)

export function isFileConfiguredCli(cliTool: string): cliTool is FileConfiguredCli {
  return FILE_CONFIGURED_CLI_TOOLS.has(cliTool)
}

export function getCliConfigTargets(cliTool: string): readonly CliConfigTarget[] {
  return isFileConfiguredCli(cliTool) ? CLI_CONFIG_TARGETS[cliTool] : []
}

const MODEL_CONFIGURED_CLI_TOOLS: ReadonlySet<string> = new Set(MODEL_CONFIGURED_CLI_TOOL_IDS)

export function isModelConfiguredCli(cliTool: string): cliTool is ModelConfiguredCli {
  return MODEL_CONFIGURED_CLI_TOOLS.has(cliTool)
}
