export enum CodeCli {
  CLAUDE_CODE = 'claude-code',
  OPENAI_CODEX = 'openai-codex',
  OPEN_CODE = 'opencode',
  OPENCLAW = 'openclaw',
  GEMINI_CLI = 'gemini-cli',
  QWEN_CODE = 'qwen-code',
  KIMI_CODE = 'kimi-code',
  QODER_CLI = 'qoder-cli',
  GITHUB_COPILOT_CLI = 'github-copilot-cli'
}

/**
 * Reserved virtual provider id for the code-CLI "use your own login" option.
 * Persisted as `CodeCliToolState.current` in place of a real provider id so the
 * launch gate passes while no Cherry provider is injected — the CLI then falls
 * back to its own stored account login. Namespaced so it never collides with a
 * real provider id.
 */
export const CLI_OWN_LOGIN_PROVIDER_ID = 'cherry:cli-own-login'

/**
 * CLI tools that can run through their own account login (OAuth) instead of a
 * Cherry provider + API key. These surface the virtual "own login" option and,
 * when it is selected, launch provider-less (no credential injection). Distinct
 * from the provider-less tools (Qoder / Copilot), which never accept a Cherry
 * provider at all.
 */
export const LOGIN_CAPABLE_CLI_TOOLS: ReadonlySet<CodeCli> = new Set([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

/**
 * Reserved virtual provider id for the code-CLI "Cherry Gateway" option. Like the
 * own-login entry it is a page-local synthetic provider (never persisted to the
 * providers store), but instead of running credential-less it injects the local
 * API gateway's URL + key into the CLI config so the real provider key never
 * lands on disk and any model is reachable through the gateway's dialect
 * conversion. Namespaced so it never collides with a real provider id.
 */
export const CLI_API_GATEWAY_PROVIDER_ID = 'cherry:api-gateway'

/**
 * Fixed ASCII provider-name segment for the gateway in CLI config keys (`cherry-gateway`).
 * The synthetic provider's card title is the localized "统一网关" (Unified Gateway), which would
 * sanitize to an empty/garbled segment; this stable name keeps the on-disk key clean and
 * locale-independent.
 */
export const CLI_API_GATEWAY_PROVIDER_NAME = 'gateway'

export function isApiGatewayProviderId(id: string): boolean {
  return id === CLI_API_GATEWAY_PROVIDER_ID
}

/**
 * CLI tools that can be backed by the Cherry API gateway. The gateway exposes
 * Anthropic (`/v1/messages`) and OpenAI (`/v1/chat/completions`, `/v1/responses`)
 * dialects only, so Gemini CLI (needs a Google endpoint) and OpenClaw (its own
 * gateway sync path) are excluded.
 */
export const GATEWAY_CAPABLE_CLI_TOOLS: ReadonlySet<CodeCli> = new Set([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.OPEN_CODE,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

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
}

export interface TerminalConfigWithCommand extends TerminalConfig {
  command: (directory: string, fullCommand: string) => { command: string; args: string[] }
}
