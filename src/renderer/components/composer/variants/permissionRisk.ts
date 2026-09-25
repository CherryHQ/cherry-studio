import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'

export type PermissionRiskEffect = 'destructive' | 'network' | 'irreversible'

// Analyze only the executable command text; the human-readable description
// may mention keywords or URLs the command itself never performs.
function getCommandText(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

// Mirrors ToolHeader's getCommandActivity patterns; this assigns risk severity,
// that assigns display labels. Check both when covering a new tool.
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
  if (/(^|[\s;&|`(/])(rm|rmdir|del|erase|rd|dd|truncate|shred|unlink)\s/i.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // `>` truncates the target file, excluding `=>`/`>=`, fd duplication (`2>&1`),
  // and null-device discards (`>/dev/null`) which write no file.
  if (/(^|[\s;&|\w])\d*>{1,2}(?!&[\d-])(?!\s*\/dev\/null\b)\s*\S/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // `find ... -delete` removes matching files in batch, scoped to one simple
  // command so a later `-delete` past `&&`/`;`/`|` can't leak in.
  if (/\bfind\b[^;&|]*\s-delete(\s|$)/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // Moving a file removes the source path and may overwrite the destination,
  // but it can be moved back, so it is not marked irreversible.
  if (/\bmv\s+\S+\s+\S+/.test(text)) {
    effects.add('destructive')
  }
  // `pwsh` normalizes to Bash before this runs, so cover PowerShell verbs here too.
  if (/\b(Remove-Item|Clear-Content|Clear-Item)\b/i.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  if (/\bMove-Item\b/i.test(text)) {
    effects.add('destructive')
  }
  // Git work-discarders, scoped to one simple command so flags past `&&`/`;`/`|`
  // can't leak. `-f` skips `-n`/`--dry-run` previews; `-D` skips safe `-d`.
  if (
    /\bgit\s+clean(?![^;&|]*--dry-run)(?![^;&|]*\s-[a-zA-Z]*n)[^;&|]*-f/.test(text) ||
    /\bgit\s+reset[^;&|]*--hard/.test(text) ||
    /\bgit\s+branch[^;&|]*-D/.test(text)
  ) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  if (/\b(?:remove|uninstall)\b/.test(lowerText) && /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo|brew)\b/.test(lowerText)) {
    effects.add('destructive')
  }
  if (
    /https?:\/\//i.test(text) ||
    /\b(?:curl|wget|scp|rsync|sftp|ssh(?!-)|nc|ncat|socat|aria2c|telnet|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(
      text
    ) ||
    /\bgit\s+(?:push|fetch|pull|clone)\b/i.test(text)
  ) {
    effects.add('network')
  }
  // Dry runs contact the remote but change nothing, so they keep `network` above.
  if (/\bgit\s+push\b(?![^;&|]*--dry-run)(?![^;&|]*\s-[a-zA-Z]*n)/i.test(text)) {
    effects.add('irreversible')
  }

  return [...effects]
}
