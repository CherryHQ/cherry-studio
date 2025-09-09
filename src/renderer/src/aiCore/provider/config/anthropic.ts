import { SystemModelMessage } from 'ai'

export function buildClaudeCodeSystemMessage(system?: string): Array<SystemModelMessage> {
  const defaultClaudeCodeSystem = `You are Claude Code, Anthropic's official CLI for Claude.`
  if (!system || system.trim() === defaultClaudeCodeSystem) {
    return [
      {
        role: 'system',
        content: defaultClaudeCodeSystem
      }
    ]
  }

  return [
    {
      role: 'system',
      content: defaultClaudeCodeSystem
    },
    {
      role: 'system',
      content: system
    }
  ]
}
