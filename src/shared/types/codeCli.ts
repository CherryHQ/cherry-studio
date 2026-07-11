export enum CodeCli {
  CLAUDE_CODE = 'claude-code',
  OPENAI_CODEX = 'openai-codex',
  OPEN_CODE = 'opencode',
  OPENCLAW = 'openclaw',
  GEMINI_CLI = 'gemini-cli',
  QWEN_CODE = 'qwen-code',
  KIMI_CODE = 'kimi-code',
  QODER_CLI = 'qoder-cli',
  GITHUB_COPILOT_CLI = 'github-copilot-cli',
  PI = 'pi'
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
