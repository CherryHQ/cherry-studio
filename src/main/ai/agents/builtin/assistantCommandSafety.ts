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
// - Structural bounding, not caps: an unquoted LEFT `==` operand may not cross a `==` boundary
//   (single `=` segments are allowed), so a failed match has exactly one operand split per
//   position and cannot repartition a run like `a==a==...` across operand boundaries - that
//   repartitioning was the quadratic. Arbitrary-length operands (257+ chars) match again,
//   restoring pre-narrowing parity; the right `==` operand and `EQU`-style operands are plain
//   space-delimited scans, which are linear. No complete cmd parser is intended.
// The `exist` operand is deliberately NOT capped: the pre-existing guard blocked a bare token of
// any length after `exist`, and `\S+` / quoted scans are plain linear repetitions, so capping it
// would only narrow coverage (a 257+ char token would stop matching and the deletion would sail through).
const CMD_QUOTED_OR_BARE = String.raw`(?:"[^"]*"|'[^']*'|[^\s]+)`
const CMD_EQ_LEFT_OPERAND = String.raw`(?:"[^"]*"|'[^']*'|[^\s=]+(?:=[^\s=]+)*)`
const CMD_EXIST_OPERAND = String.raw`(?:"[^"]*"|'[^']*'|\S+)`
const CMD_COMPARISON_OPERANDS = String.raw`${CMD_QUOTED_OR_BARE}\s+(?:EQU|NEQ|LSS|LEQ|GTR|GEQ)\s+${CMD_QUOTED_OR_BARE}`
const CMD_CONDITIONAL_PREFIX = String.raw`\bif\s+(?:\/i\s+)?(?:not\s+)?(?:exist\s+${CMD_EXIST_OPERAND}|defined\s+\S+|errorlevel\s+\d+|cmdextversion\s+\d+|${CMD_EQ_LEFT_OPERAND}\s*==\s*${CMD_QUOTED_OR_BARE}|${CMD_COMPARISON_OPERANDS})(?=\s)`
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
// `start` accepts any mix of quoted titles, switches and switch values before the program word:
// `start /b del x`, `start "t" /min del x`, `start /d C:\ del x`. Tokens are disjoint by first
// character, so each position has one parse, and the unbounded count mirrors the unbounded
// argument list instead of drawing a line a valid command can cross. A bare value may be neither
// the deletion word nor `start` itself: without that, every `start` word in the string would
// restart an argument scan over the whole remainder (quadratic), and nested `start start del x`
// still denies because the unanchored retry anchors at the innermost `start`. The anchor itself
// is suppressed after argument-token characters (`/start`, `\start`, `foo-start`): a `start`
// glued to an argument token is not the start command (an echo-suppression `@` only counts at a
// command position, so `/x@start` stays an argument), and every such token would otherwise
// restart an argument scan (quadratic, e.g. `/start ` repeated). The glue run between token and
// `start` (quotes, `@`, backticks) is checked through a fixed 64-character window: real
// decorations are 1-3 characters, a bounded lookbehind costs at most 64 characters of backscan
// per position on any regex engine (an unbounded window is quadratic per position on engines
// that cannot skip it via first-char analysis). A separate fixed-width check refuses to anchor a
// `start` buried under 65 or more glue characters: the check costs a fixed 65-character
// compare per position on any engine, and without it those anchors each rescan the remaining
// argument list (quadratic). The banned long-glue anchors are not lost: the linear scanner
// below (longGlueStartDeletion) restores exactly that family - a `start` preceded by a 65+
// glue run - with an O(n) memoized token walk mirroring CMD_START_ARGS, the atomic gap and
// the deletion tail, so the regex-plus-scanner union keeps the pre-ban deny coverage while
// both halves stay linear. Command-position starts - after
// whitespace, separators, quotes or a batch `@` echo-suppression prefix - still anchor, so
// `@start /b del x` and nested starts keep denying. Bare values stop at `@start` too: an
// echo-suppressed start token is a command, not an argument - and neither is a quote-prefixed
// one (`'start`) or a backtick-prefixed one (` + '`' + `start` + '`' + `): decorated start tokens still anchor their own scan,
// so swallowing them as arguments would only restart overlapping suffix scans.
// A quoted argument whose content CONTAINS a command-position (glue-decorated) `start`
// token followed by whitespace is refused here on purpose: that token anchors its own start
// scan, and consuming it as an argument would restart an overlapping suffix scan once per
// embedded `start` anchor (quadratic on `echo "start /b" "start /b" ...` and on
// `echo "a start /b" "a start /b" ...`). The check covers content starting with the token
// and content where it follows any non-word character; titles that are exactly `start` (no
// trailing whitespace) still consume: their inner anchor cannot fire, so refusing them would
// lose the deny on `start "start" del x`. Denies dropped here are restored by the linear
// scanner below, which walks every command-position start anchor with untempered arguments.
const CMD_START_ARGS =
  String.raw`(?:\s+"(?!(?:[^"\r\n]*[^\w\u0080-\uffff])?[@` +
  '`' +
  String.raw`"']*start\s)[^"\r\n]*"|\s+\/[a-zA-Z][^\s;&|/]*|\s+(?!del\b|erase\b|rd\b|[@'` +
  '`' +
  String.raw`]*start\b)[^\s;&|/"(){}]+)+`
const POWERSHELL_LAUNCHER = String.raw`\b(?:powershell|pwsh)(?:\.exe)?(?:\s+-[a-zA-Z][^\s]{0,31}(?:\s+(?![-\"'\s])[^\s]{1,31})?){0,8}(?=\s+["']?(?:del|erase|rd)\b)`
// The gap before the deletion token is one atomic scan: the lookahead captures the maximal run of
// whitespace/quotes/`@` and the backreference re-matches it, so a failed token check cannot split the
// run across adjacent quantifiers (split ambiguity was the quadratic here). The pattern has no other
// capture groups, so the backreference stays group 1 - keep it that way.
// A newline acts as a command separator only when no newline precedes it inside the same gap
// run: the expression is unanchored, so every later newline (including alternating space/CR/
// quote mixes) would restart a maximal gap rescan - quadratic. The lookbehind checks backwards
// only as far as the nearest preceding newline (lazy run), so a whole run stays linear, and a
// newline after other gap characters still fires at the run's first newline.
// `start` may carry arguments before the deletion token (`start /b del x`), a PowerShell
// assignment target may precede it (`$null = del x`, including scoped targets like
// `$script:output = del x`, indexed, property, braced or quoted targets like `$a[0] =` / `$h.result =` / `${output} =` / `$h."result" =`
// (an index segment allows one nesting level, so `$a[$i]` and `$a[$b[0]]` deny;
// deeper nesting stays a documented best-effort gap), and compound operators
// like `+=` - every assignment form evaluates its right-hand side), a PowerShell invocation keyword or operator may precede it (`return`,
// `iex`/`Invoke-Expression`, and dot invocation `. del x` - the dot anchor requires a
// command-position predecessor (start, whitespace, quote, `@` or a separator), so a sentence
// period in prose like `cleanup. erase` does not anchor), and the token itself may be followed by
// adjacent redirections (`del>nul x`) - all ordinary executable deletion forms that keep the
// enforced deny. A `$var =` mention inside prose still denies, matching the pre-narrowing
// guard: the mention is indistinguishable from a real assignment without full quoting state.
const WINDOWS_AMBIGUOUS_DELETE_PATTERN = new RegExp(
  String.raw`(?:^|[;&|(){` +
    '`' +
    String.raw`]|(?=[\r\n])(?<![\r\n](?:\s|["']|@)*?)[\r\n]|\/[ck]|-[a-z]*c|-command|\b(?:call|xargs|sudo|exec|exit|then|do|else|return|throw|iex|Invoke-Expression)(?=\s)|(?<![^\s;&|(){}"'` +
    '`' +
    String.raw`@])\.(?=\s)|(?<![@` +
    '`' +
    String.raw`"']{65})(?<![^\s;&|(){}"'` +
    '`' +
    String.raw`@][@` +
    '`' +
    String.raw`"']{0,64})\bstart(?=\s)|(?<![@` +
    '`' +
    String.raw`"']{65})(?<![^\s;&|(){}"'` +
    '`' +
    String.raw`@][@` +
    '`' +
    String.raw`"']{0,64})\bstart${CMD_START_ARGS}(?=\s)|(?:\[[^\[\]\r\n]+\](?:::[\w\u0080-\uffff]+)+|\$[\w\u0080-\uffff][\w\u0080-\uffff]*(?::[\w\u0080-\uffff][\w\u0080-\uffff]*)?|\$\{[^{}\r\n]*\})(?:\.[\w\u0080-\uffff]+|\.(?:"[^"\r\n]*(?:""[^"\r\n]*)*"|'[^'\r\n]*(?:''[^'\r\n]*)*')|\[(?:[^\[\]\r\n]|\[[^\[\]\r\n]*\])*\])*\s*(?:[-+*/%]|\?\?)?=(?!=)|\bexist\s+${CMD_EXIST_OPERAND}(?=\s)|${CMD_CONDITIONAL_PREFIX}|${CMD_REDIRECT_PREFIX}|${POWERSHELL_LAUNCHER})(?=((?:\s|["']|@)*))\1(?:del|erase|rd)(?=\s|$|["'(]|>>?|<)`,
  'i'
)

// Linear scanner restoring the >=65-glue `start` anchor family that the bounded {65} lookbehind
// ban above suppresses. The regex covers glue runs of 0-64 (its window lookbehind) and every
// non-start anchor; this scanner covers exactly the banned anchors: a `start` token immediately
// preceded by a glue run (`@`, backtick, `"`, `'`) of length >= 65. Anchoring mirrors the
// unbounded-window semantics the {0,64} window approximates: any predecessor character is
// accepted, matching the pre-ban behavior for long runs. The continuation mirrors
// CMD_START_ARGS (quoted / switch / bare token edges are disjoint and deterministic, so each
// position has exactly one successor) plus the atomic gap (`\s`, `"`, `'`, `@` - no backtick,
// matching the regex gap class) and the `del|erase|rd` tail with its following boundary.
// Per-position memoization makes the reachability walk O(n) total: independent per-candidate
// rescans would be quadratic on composed inputs.
const SCAN_WS = /\s/
const SCAN_GLUE = new Set(['@', '`', '"', "'"])
const SCAN_GAP = new Set(['"', "'", '@'])
const SCAN_BARE_EXCLUDE = new Set([';', '&', '|', '/', '"', '(', ')', '{', '}'])
const SCAN_SEP = new Set([';', '&', '|', '(', ')', '{', '}'])
const isScanWord = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_'
const scanLower = (c: string): string => (c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c)
function scanWordAt(s: string, i: number, w: string): boolean {
  for (let k = 0; k < w.length; k++) if (scanLower(s[i + k] ?? '') !== w[k]) return false
  return true
}
// Token end from token-start p, or -1 if no valid CMD_START_ARGS token starts here.
function scanTokenEnd(s: string, n: number, p: number): number {
  const c = s[p]
  if (c === '"') {
    for (let j = p + 1; j < n; j++) {
      const d = s[j]
      if (d === '"') return j + 1
      if (d === '\r' || d === '\n') return -1
    }
    return -1
  }
  if (c === '/' && p + 1 < n && /[a-zA-Z]/.test(s[p + 1])) {
    let j = p + 2
    while (j < n && !SCAN_WS.test(s[j]) && ![';', '&', '|', '/'].includes(s[j])) j++
    return j
  }
  if (!SCAN_WS.test(c) && !SCAN_BARE_EXCLUDE.has(c)) {
    let j = p + 1
    while (j < n && !SCAN_WS.test(s[j]) && !SCAN_BARE_EXCLUDE.has(s[j])) j++
    // bare-token exclusions: del/erase/rd or glue*start at token start (both with a right boundary)
    for (const w of ['del', 'erase', 'rd']) if (scanWordAt(s, p, w) && !isScanWord(s[p + w.length] ?? '')) return -1
    let q = p
    while (q < n && SCAN_GLUE.has(s[q])) q++
    if (scanWordAt(s, q, 'start') && !isScanWord(s[q + 5] ?? '')) return -1
    return j
  }
  return -1
}
function longGlueStartDeletion(s: string): boolean {
  const n = s.length
  // acceptPos[e]: s[e] is whitespace and the maximal gap run containing e ends right before a
  // del|erase|rd token with the regex's following boundary. Built run by run: O(n) total.
  const accept = new Uint8Array(n)
  let i = 0
  while (i < n) {
    if (SCAN_WS.test(s[i]) || SCAN_GAP.has(s[i])) {
      let d = i
      while (d < n && (SCAN_WS.test(s[d]) || SCAN_GAP.has(s[d]))) d++
      let len = 0
      for (const w of ['erase', 'del', 'rd']) {
        if (scanWordAt(s, d, w)) {
          len = w.length
          break
        }
      }
      if (len) {
        const after = s[d + len]
        if (d + len >= n || SCAN_WS.test(after) || after === '"' || after === "'" || after === '>' || after === '<') {
          for (let e = i; e < d; e++) if (SCAN_WS.test(s[e])) accept[e] = 1
        }
      }
      i = d
    } else i++
  }
  // Memoized args-chain reachability: good(e) = some args* continuation from e lands on accept.
  const memo = new Map<number, boolean>()
  function good(e: number): boolean {
    let cur = e
    const path: number[] = []
    while (true) {
      if (accept[cur]) {
        for (const p of path) memo.set(p, true)
        return true
      }
      const m = memo.get(cur)
      if (m !== undefined) {
        for (const p of path) memo.set(p, m)
        return m
      }
      path.push(cur)
      let j = cur
      while (j < n && SCAN_WS.test(s[j])) j++
      if (j === cur || j >= n) {
        for (const p of path) memo.set(p, false)
        return false
      }
      const te = scanTokenEnd(s, n, j)
      if (te < 0) {
        for (const p of path) memo.set(p, false)
        return false
      }
      cur = te
    }
  }
  // Anchors: any command-position `start` (case-insensitive, word boundary on the left).
  // Glue runs of 0-64 need a separator/whitespace/string-start predecessor (the regex
  // window's semantics); runs >=65 accept any predecessor (the pre-ban long-run semantics).
  // The untempered args walk here restores deny coverage the regex's quoted-branch temper
  // drops when an early anchor's argument chain swallows later quoted `start` tokens.
  for (let a = 0; a + 5 <= n; a++) {
    if (!scanWordAt(s, a, 'start')) continue
    if (a > 0 && isScanWord(s[a - 1])) continue // \b
    let r = a - 1
    while (r >= 0 && SCAN_GLUE.has(s[r])) r--
    const runLen = a - 1 - r
    if (runLen < 65 && r >= 0 && !SCAN_WS.test(s[r]) && !SCAN_SEP.has(s[r])) continue
    if (good(a + 5)) return true
  }
  return false
}

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
  return (
    DESTRUCTIVE_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.reason ??
    (longGlueStartDeletion(normalized) ? 'permanent Windows file deletion' : undefined)
  )
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
