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
const GITHUB_ISSUE_CREATION_PATTERN =
  /(?:^\s*|[;&|]\s*|\r?\n\s*)(?:"(?:[^"\r\n]*[\\/])?gh(?:\.exe)?"|'(?:[^'\r\n]*[\\/])?gh(?:\.exe)?'|(?:[^\s;&|]*[\\/])?gh(?:\.exe)?)\s+issue\s+create(?:\s|$)/i

// `del`/`erase`/`rd` are ordinary words in prose (e.g. Spanish "del"), so only match them in command position.
// Command position includes cmd.exe conditional prefixes (`if [/i] [not] exist|defined|errorlevel|
// cmdextversion|<operand>==<operand>|<operand> EQU|NEQ|LSS|LEQ|GTR|GEQ <operand>`, operands may be
// quoted), a batch `@` echo-suppression prefix on the deletion token (whitespace is allowed between
// `@` and the command - `@ echo off` is idiomatic, so `@ del` executes like `@del`), and a bare
// powershell/pwsh prefix
// (with optional .exe suffix and bounded launcher flags with at most one value each, such as -nop or -ep bypass), since those still
// execute the deletion.
// Two deliberate limits, both acceptable for a deny-side guard:
// - Conservative blocking: prose that contains a syntactically valid conditional (e.g.
//   "echo if a==b then del is risky") still blocks, matching pre-existing behavior; erring toward
//   deny is safe here.
// - Bounded fragments: unquoted EQUALITY operands are capped at 256 chars so the pattern stays
//   linear on adversarial input (the tool command string is unbounded and this runs on the main
//   thread). Longer equality operands remain covered when quoted. No complete cmd parser is intended.
// The `exist` operand is deliberately NOT capped: the pre-existing guard blocked a bare token of
// any length after `exist`, and `\S+` / quoted scans are plain linear repetitions, so capping it
// would only narrow coverage (a 257+ char token would stop matching and the deletion would sail through).
const CMD_QUOTED_OR_SHORT = String.raw`(?:"[^"]*"|'[^']*'|\S{1,256})`
const CMD_EXIST_OPERAND = String.raw`(?:"[^"]*"|'[^']*'|\S+)`
const CMD_COMPARISON_OPERANDS = String.raw`${CMD_QUOTED_OR_SHORT}\s+(?:EQU|NEQ|LSS|LEQ|GTR|GEQ)\s+${CMD_QUOTED_OR_SHORT}`
const CMD_CONDITIONAL_PREFIX = String.raw`\bif\s+(?:\/i\s+)?(?:not\s+)?(?:exist\s+${CMD_EXIST_OPERAND}|defined\s+\S+|errorlevel\s+\d+|cmdextversion\s+\d+|${CMD_QUOTED_OR_SHORT}\s*==\s*${CMD_QUOTED_OR_SHORT}|${CMD_COMPARISON_OPERANDS})(?=\s)`
// CMD and sh both allow redirections before the command word (`2>nul del x`, `>log 2>&1 rd x`,
// `<nul erase x`), with optional whitespace between operator and target (`2> nul del x`). Targets
// stay unbounded: the unquoted form excludes whitespace, redirection and quote characters, inner
// whitespace is consumed only between redirects via lookahead, and trailing whitespace belongs to
// the atomic gap below, so each position has exactly one parse and matching stays linear on the
// main thread. The fragment loop is bounded ({1,8}): the expression is unanchored, so a failing
// run of redirects would otherwise be rescanned from every redirect start (quadratic). Detection
// is unaffected: a match may start at any of the last <=8 redirects before the deletion token.
const CMD_REDIRECT_TARGET = String.raw`(?:&[0-9]|"[^"]*"|'[^']*'|[^\s;&|<>"']+)`
const CMD_REDIRECT_PREFIX = String.raw`(?:[0-9]?(?:>>?|<)\s*${CMD_REDIRECT_TARGET}(?:\s+(?=[0-9]?(?:>>?|<)))?){1,8}`
const POWERSHELL_LAUNCHER = String.raw`\b(?:powershell|pwsh)(?:\.exe)?(?:\s+-[a-zA-Z][^\s]{0,31}(?:\s+(?![-\"'\s])[^\s]{1,31})?){0,8}(?=\s+["']?(?:del|erase|rd)\b)`
// The gap before the deletion token is one atomic scan: the lookahead captures the maximal run of
// whitespace/quotes/`@` and the backreference re-matches it, so a failed token check cannot split the
// run across adjacent quantifiers (split ambiguity was the quadratic here). The pattern has no other
// capture groups, so the backreference stays group 1 - keep it that way.
const WINDOWS_AMBIGUOUS_DELETE_PATTERN = new RegExp(
  String.raw`(?:^|[;&|(){\r\n` +
    '`' +
    String.raw`]|\/[ck]|-[a-z]*c|-command|\b(?:call|start|xargs|sudo|exec|then|do|else)(?=\s)|\bexist\s+${CMD_EXIST_OPERAND}(?=\s)|${CMD_CONDITIONAL_PREFIX}|${CMD_REDIRECT_PREFIX}|${POWERSHELL_LAUNCHER})(?=((?:\s|["']|@)*))\1(?:del|erase|rd)(?=\s|$|["'])`,
  'i'
)

const DESTRUCTIVE_COMMAND_PATTERNS: readonly DestructiveCommandPattern[] = [
  {
    reason: 'permanent file deletion',
    pattern: /\b(?:rm|unlink|shred|srm)\b/i
  },
  {
    reason: 'permanent Windows file deletion',
    pattern: /\b(?:remove-item|clear-content|rmdir)\b/i
  },
  {
    reason: 'permanent Windows file deletion',
    pattern: WINDOWS_AMBIGUOUS_DELETE_PATTERN
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

export function isGitHubIssueCreationCommand(command: string): boolean {
  const normalized = command.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, ' ')
  return GITHUB_ISSUE_CREATION_PATTERN.test(normalized)
}

export function isPermanentDeletionToolName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false
  const sourceToolName = toolName.split('__').at(-1)?.toLowerCase()
  return ['delete', 'delete_file', 'delete_directory', 'remove_file', 'remove_directory'].includes(sourceToolName ?? '')
}
