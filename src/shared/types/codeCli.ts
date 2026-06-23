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
