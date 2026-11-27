import { AgentToolsType } from '@renderer/components/chat/messages/tools/shared/agentToolTypes'

export type PermissionRiskEffect = 'destructive' | 'network' | 'irreversible'

// Analyze only the executable command text; the human-readable description
// may mention keywords or URLs the command itself never performs.
function getCommandText(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : ''
}

// Git global options (`-C <repo>`, `-c k=v`, …) precede the subcommand, so strip them to let the
// per-subcommand checks below anchor on `git <sub>`.
const GIT_GLOBAL_OPTIONS = /\bgit\s+(?:(?:-[Cc]\s+\S+|-\S+)\s*)+/g

// Mirrors ToolHeader's getCommandActivity patterns; this assigns risk severity,
// that assigns display labels. Check both when covering a new tool.
export function getPermissionRiskEffects(toolName: string, args: unknown): PermissionRiskEffect[] {
  const effects = new Set<PermissionRiskEffect>()
  const text = getCommandText(args)
  const gitText = text.replace(GIT_GLOBAL_OPTIONS, 'git ')
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
  // `>` truncates the target file. Quotes are separators too, because a redirect adjoined to a
  // quoted argument (`printf "new">f`) writes; `=>`/`>=`, fd duplication and /dev/null do not.
  if (/(^|[\s;&|\w"'`])\d*>{1,2}(?!&[\d-])(?!\s*\/dev\/null\b)(?![=>])\s*\S/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // `find ... -delete` removes matching files in batch, scoped to one simple
  // command so a later `-delete` past `&&`/`;`/`|` can't leak in.
  if (/\bfind\b[^;&|\n]*\s-delete(\s|$)/.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  // Moving a file removes the source path and may overwrite the destination,
  // but it can be moved back, so it is not marked irreversible.
  if (/\bmv\s+\S+\s+\S+/.test(text)) {
    effects.add('destructive')
  }
  // Copying onto an existing destination overwrites it, so flag it like `mv`.
  if (/\bcp\s+\S+\s+\S+/.test(text)) {
    effects.add('destructive')
  }
  // `pwsh` normalizes to Bash before this runs, so cover PowerShell verbs here too.
  // `-WhatIf` / `-WhatIf:$true` previews change nothing, scoped to one simple command (newlines included);
  // `-WhatIf:$false` or an unresolved value disables preview, so it must not suppress the warning.
  if (/\b(Remove-Item|Clear-Content|Clear-Item)\b(?![^;&|\n]*\s-WhatIf(?::\$true)?(?=[\s;&|]|$))/i.test(text)) {
    effects.add('destructive')
    effects.add('irreversible')
  }
  if (/\bMove-Item\b(?![^;&|\n]*\s-WhatIf(?::\$true)?(?=[\s;&|]|$))/i.test(text)) {
    effects.add('destructive')
  }
  // Git work-discarders, scoped to one simple command so flags past `&&`/`;`/`|` (or newline)
  // can't leak. `restore`/`checkout --` reset the working tree; `restore --staged` only unstages.
  if (
    /\bgit\s+clean(?![^;&|\n]*--dry-run)(?![^;&|\n]*\s-[a-zA-Z]*n)[^;&|\n]*\s(?:-[a-zA-Z]*f|--force\b)/.test(gitText) ||
    /\bgit\s+reset[^;&|\n]*--hard/.test(gitText) ||
    /\bgit\s+branch[^;&|\n]*-D/.test(gitText) ||
    /\bgit\s+restore\b(?![^;&|\n]*--staged)/i.test(gitText) ||
    /\bgit\s+restore\b[^;&|\n]*--worktree/i.test(gitText) ||
    /\bgit\s+checkout[^;&|\n]*(?:^|\s)--(?:\s|$)/.test(gitText)
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
    /\bgit\s+(?:push|fetch|pull|clone)\b/i.test(gitText)
  ) {
    effects.add('network')
  }
  // Dry runs contact the remote but change nothing, so they keep `network` above.
  if (/\bgit\s+push\b(?![^;&|\n]*--dry-run)(?![^;&|\n]*\s-[a-zA-Z]*n)/i.test(gitText)) {
    effects.add('irreversible')
  }

  return [...effects]
}
