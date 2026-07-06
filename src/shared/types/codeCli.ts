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
