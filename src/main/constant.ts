export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
export const isDev = process.env.NODE_ENV === 'development'
export const isPortable = isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env
export enum codeTools {
  qwenCode = 'qwen-code',
  claudeCode = 'claude-code',
  geminiCli = 'gemini-cli',
  openaiCodex = '@openai/codex'
}
