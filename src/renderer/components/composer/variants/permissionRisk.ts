import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'

export type PermissionRiskEffect = 'destructive' | 'network' | 'irreversible'

function getCommandText(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const command = (args as Record<string, unknown>).command
  const description = (args as Record<string, unknown>).description
  return `${typeof description === 'string' ? description : ''} ${typeof command === 'string' ? command : ''}`
}

export function getPermissionRiskEffects(toolName: string, args: unknown): PermissionRiskEffect[] {
  const effects = new Set<PermissionRiskEffect>()
  const text = getCommandText(args)
  const lowerText = text.toLowerCase()

  if (
    toolName === AgentToolsType.Write ||
    toolName === AgentToolsType.Edit ||
    toolName === AgentToolsType.MultiEdit ||
    toolName === AgentToolsType.NotebookEdit
  ) {
    effects.add('destructive')
    effects.add('irreversible')
    return [...effects]
  }

  if (toolName === AgentToolsType.WebFetch || toolName === AgentToolsType.WebSearch) {
    effects.add('network')
    return [...effects]
  }

  if (toolName !== AgentToolsType.Bash && toolName !== AgentToolsType.BashOutput) return []

  if (/(^|[\s;&|])(rm|rmdir|del|erase|rd)\s/i.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  if (/\b(?:remove|uninstall)\b/.test(lowerText) && /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo|brew)\b/.test(lowerText)) {
    effects.add('destructive')
  }
  if (/https?:\/\//i.test(text) || /\b(?:curl|wget)\b/i.test(text) || /\bgit\s+(?:push|fetch|pull)\b/i.test(text)) {
    effects.add('network')
  }
  if (/\bgit\s+push\b/i.test(text)) {
    effects.add('irreversible')
  }

  return [...effects]
}
