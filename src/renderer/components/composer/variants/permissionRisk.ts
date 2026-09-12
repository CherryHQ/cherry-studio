import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'

export type PermissionRiskEffect = 'destructive' | 'network' | 'irreversible'

// Only the executable command text is analyzed. The human-readable
// description may mention keywords like "remove" or URLs without the
// command itself performing those operations.
function getCommandText(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

// This classifier parallels the activity wording in ToolHeader's
// getCommandActivity: both pattern-match shell commands, but this one assigns
// risk severity while that one assigns display labels. Check both when newly
// covering a tool.
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
  // Shell output redirection truncates or modifies the target file. A word
  // character may precede `>` (as in `hi>file`), while `=` stays excluded so
  // `=>` and `>=` in inline scripts still don't match. The lookahead skips
  // fd-to-fd duplication such as `2>&1` and `>&-`, but still flags `>& file`,
  // which writes to a file.
  if (/(^|[\s;&|\w])\d*>{1,2}(?!&[\d-])\s*\S/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // `find ... -delete` removes matching files in batch.
  if (/\bfind\b[\s\S]*\s-delete(\s|$)/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // Moving a file removes the source path and may overwrite the destination,
  // but it can be moved back, so it is not marked irreversible.
  if (/\bmv\s+\S+\s+\S+/.test(text)) {
    effects.add('destructive')
  }
  // Git operations that discard work. `clean` requires `-f` because bare
  // `clean -n` is a dry run, and `branch` requires uppercase `-D` because
  // lowercase `-d` refuses unmerged branches.
  if (
    /\bgit\s+clean[\s\S]*-f/.test(text) ||
    /\bgit\s+reset[\s\S]*--hard/.test(text) ||
    /\bgit\s+branch[\s\S]*-D/.test(text)
  ) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  if (/\b(?:remove|uninstall)\b/.test(lowerText) && /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo|brew)\b/.test(lowerText)) {
    effects.add('destructive')
  }
  if (
    /https?:\/\//i.test(text) ||
    /\b(?:curl|wget|scp|rsync|sftp|ssh|nc|ncat|socat|aria2c|telnet)\b/i.test(text) ||
    /\bgit\s+(?:push|fetch|pull|clone)\b/i.test(text)
  ) {
    effects.add('network')
  }
  if (/\bgit\s+push\b/i.test(text)) {
    effects.add('irreversible')
  }

  return [...effects]
}
