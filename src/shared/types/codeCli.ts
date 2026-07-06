export enum CodeCli {
  QWEN_CODE = 'qwen-code',
  CLAUDE_CODE = 'claude-code',
  GEMINI_CLI = 'gemini-cli',
  OPENAI_CODEX = 'openai-codex',
  QODER_CLI = 'qoder-cli',
  GITHUB_COPILOT_CLI = 'github-copilot-cli',
  KIMI_CLI = 'kimi-cli',
  OPEN_CODE = 'opencode'
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
  customPath?: string // For user-configured terminal paths on Windows
}

export interface TerminalConfigWithCommand extends TerminalConfig {
  command: (directory: string, fullCommand: string) => { command: string; args: string[] }
}
