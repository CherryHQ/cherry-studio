interface DestructiveCommandPattern {
  reason: string
  pattern: RegExp
}

const SHELL_ARGUMENT_PATTERN = String.raw`(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;&|]+)`
const GIT_GLOBAL_OPTION_PATTERN = String.raw`(?:(?:-C|-c|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)\s+${SHELL_ARGUMENT_PATTERN}|(?:--exec-path|--git-dir|--work-tree|--namespace|--super-prefix|--config-env|--list-cmds|--attr-source)=${SHELL_ARGUMENT_PATTERN}|-p|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--no-literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch|--no-advice)`
const GIT_DESTRUCTIVE_COMMAND_PATTERN = new RegExp(
  String.raw`\bgit(?:\s+${GIT_GLOBAL_OPTION_PATTERN})*\s+(?:clean\b|reset\s+--hard\b|checkout\s+(?:(?:[^\s;&|]+)\s+)?--(?:\s|$)|checkout\s+\.(?:[\\/][^\s;&|]*)?(?:\s|$)|(?:checkout|switch)\b[^\r\n;&|]*(?:--discard-changes|--force|-f)(?:\s|$)|restore\b|branch\s+-D\b|stash\s+(?:drop|clear)\b)`,
  'i'
)
const LARK_FORM_SUBMISSION_PATTERN =
  /(?:^|[\s;&|])(?:"[^"\r\n]*lark-cli"|'[^'\r\n]*lark-cli'|[^\s;&|]*lark-cli)\s+base\s+\+form-submit(?:\s|$)/i

const DESTRUCTIVE_COMMAND_PATTERNS: readonly DestructiveCommandPattern[] = [
  {
    reason: 'permanent file deletion',
    pattern: /\b(?:rm|unlink|shred|srm)\b/i
  },
  {
    reason: 'permanent Windows file deletion',
    pattern: /\b(?:remove-item|clear-content|del|erase|rd|rmdir)\b/i
  },
  {
    reason: 'scripted permanent file deletion',
    pattern: /\b(?:shutil\.rmtree|os\.(?:remove|unlink|rmdir)|fs\.(?:rm|unlink|rmdir)(?:sync)?)\b/i
  },
  {
    reason: 'recursive find deletion',
    pattern: /\bfind\b[\s\S]*\s-delete(?:\s|$)/i
  },
  {
    reason: 'disk formatting or wiping',
    pattern:
      /\b(?:mkfs(?:\.[a-z0-9]+)?|wipefs|fdisk|cfdisk|sfdisk|diskpart|format-volume|clear-disk|initialize-disk)\b|\bformat\s+[a-z]:|\bdd\b[\s\S]*\bof=\/dev\/|\bdiskutil\s+(?:eraseDisk|eraseVolume|partitionDisk)\b/i
  },
  {
    reason: 'discarding version-control data',
    pattern: GIT_DESTRUCTIVE_COMMAND_PATTERN
  },
  {
    reason: 'destructive database operation',
    pattern: /\b(?:drop\s+(?:database|schema|table)|truncate\s+table|delete\s+from)\b/i
  },
  {
    reason: 'destructive infrastructure operation',
    pattern:
      /\b(?:terraform\s+destroy|kubectl\s+delete|helm\s+uninstall)\b|\bdocker\b[\s\S]*\b(?:prune|rmi?)\b|\b(?:aws|gcloud|az)\b[\s\S]*\b(?:delete|destroy|remove)\b/i
  },
  {
    reason: 'system shutdown or service destruction',
    pattern:
      /\b(?:shutdown|reboot|poweroff|halt)\b|\bsystemctl\s+(?:disable|mask)\b|\blaunchctl\s+(?:unload|remove)\b|\bsc(?:\.exe)?\s+delete\b|\breg(?:\.exe)?\s+delete\b/i
  },
  {
    reason: 'security-log or shell-history erasure',
    pattern: /\b(?:wevtutil\s+cl|history\s+-c|clear-history|journalctl\b[\s\S]*--vacuum)\b/i
  },
  {
    reason: 'a process-exhaustion payload',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/i
  }
]

export function detectDestructiveAssistantCommand(command: string): string | undefined {
  const normalized = command.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, ' ')
  return DESTRUCTIVE_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.reason
}

export function isLarkFormSubmissionCommand(command: string): boolean {
  const normalized = command.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, ' ')
  return LARK_FORM_SUBMISSION_PATTERN.test(normalized)
}

export function isPermanentDeletionToolName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false
  const sourceToolName = toolName.split('__').at(-1)?.toLowerCase()
  return ['delete', 'delete_file', 'delete_directory', 'remove_file', 'remove_directory'].includes(sourceToolName ?? '')
}
