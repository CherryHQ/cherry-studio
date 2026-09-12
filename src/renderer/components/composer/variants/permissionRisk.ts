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

  // BashOutput only reads output from an already-running command, so it never carries risk.
  if (toolName !== AgentToolsType.Bash) return []

  // The `(`, backtick, and `/` separators also catch commands inside $(...),
  // backticks, and invocations by absolute path such as /usr/bin/rm.
  if (/(^|[\s;&|`(/])(rm|rmdir|del|erase|rd|dd|truncate)\s/i.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // Shell output redirection truncates or modifies the target file. The leading
  // separator requirement keeps `=>` and `>=` in inline scripts from matching,
  // and the lookahead skips fd-to-fd duplication such as `2>&1`.
  if (/(^|[\s;&|])\d*>{1,2}(?!&)\s*\S/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // Moving a file removes the source path and may overwrite the destination,
  // but it can be moved back, so it is not marked irreversible.
  if (/\bmv\s+\S+\s+\S+/.test(text)) {
    effects.add('destructive')
  }
  if (/\b(?:remove|uninstall)\b/.test(lowerText) && /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo|brew)\b/.test(lowerText)) {
    effects.add('destructive')
  }
  if (
    /https?:\/\//i.test(text) ||
    /\b(?:curl|wget|scp|rsync|sftp|ssh|nc)\b/i.test(text) ||
    /\bgit\s+(?:push|fetch|pull|clone)\b/i.test(text)
  ) {
    effects.add('network')
  }
  if (/\bgit\s+push\b/i.test(text)) {
    effects.add('irreversible')
  }

  return [...effects]
}
