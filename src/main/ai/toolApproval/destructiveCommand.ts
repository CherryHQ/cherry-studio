import { hasAmbiguousShellSyntax, splitShellSegments } from './shellSegments'

/**
 * Detects shell commands whose damage is not undoable, so the `auto` permission mode can hand the
 * decision back to the user instead of running them unattended.
 *
 * SCOPE — this is a usability guard, not a security boundary. A shell can express deletion in
 * unbounded ways (`$(base64 -d <<< …)`, a script file, a here-doc, an alias), so a pattern list can
 * only catch the conventional forms an agent actually emits. The defensible part of `auto` is the
 * path containment check in the approval extension; this list exists so a model that fires
 * `rm -rf build` still gets a prompt. Never present it as "auto mode is safe".
 *
 * A match means PROMPT, not block: the user may well want `rm -rf node_modules`.
 *
 * Matching is anchored on each pipeline stage's COMMAND word, never on a substring, so
 * `echo "rm the file"` and `grep -f patterns` stay quiet.
 */

/** Prefixes that delegate to the real command behind them. */
const WRAPPERS = new Set(['time', 'nohup', 'env', 'command', 'exec', 'builtin', 'xargs'])
const RESERVED_WORDS = {
  bash: new Set('if then else elif while until do ! { } ( )'.split(' ')),
  powershell: new Set('{ } ( ) if else while do until'.split(' '))
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'ksh', 'dash', 'fish'])
/** Service-manager subcommands that only report state (`list-units`, `is-system-running`, …). */
const READ_ONLY_SERVICE_ARG = /(?:^|\s)(?:status|list[\w-]*|show|is-[\w-]+|cat|print|-l|--status-all)(?:\s|$)/
/** `git restore --staged` only unstages; adding `--worktree` makes it discard edits again. */
const GIT_RESTORE_UNSTAGE_ONLY = /\s--staged\b/

interface Stage {
  /** The resolved command word, lowercased and stripped of any path (`/bin/rm` → `rm`). */
  command: string
  /** The stage as written, for flag tests. */
  text: string
  elevated: boolean
}

const RULES: Array<{ test: (stage: Stage) => boolean; reason: string }> = [
  {
    test: (s) => s.command === 'rm',
    reason: 'file deletion (rm)'
  },
  {
    test: (s) => s.command === 'rmdir' || s.command === 'shred' || s.command === 'srm',
    reason: 'directory or secure deletion'
  },
  {
    test: (s) => (s.command === 'find' || s.command === 'fd') && /(?:^|\s)(?:-delete\b|-exec\s+rm\b)/.test(s.text),
    reason: 'bulk deletion through find'
  },
  {
    test: (s) =>
      ['dd', 'mkfs', 'diskutil', 'fdisk', 'parted'].some((c) => s.command === c || s.command.startsWith(`${c}.`)),
    reason: 'raw disk or filesystem operation'
  },
  {
    // History rewrites and working-tree wipes discard uncommitted or unpushed work. `restore` and a
    // path-form `checkout` are the ones an agent reaches for most and they are just as final.
    test: (s) => {
      if (s.command !== 'git') return false
      if (/\srestore\b/.test(s.text)) {
        return !GIT_RESTORE_UNSTAGE_ONLY.test(s.text) || /\s--worktree\b/.test(s.text)
      }
      return /\s(?:clean\b.*\s-[a-zA-Z]*[fx]|reset\s+--hard|checkout\s+(?:--\s|\.(?:\s|$))|push\b.*--force)/.test(
        s.text
      )
    },
    reason: 'destructive git operation'
  },
  {
    test: (s) => s.command === 'truncate',
    reason: 'file truncation'
  },
  {
    test: (s) =>
      (s.command === 'chmod' || s.command === 'chown') && /(?:^|\s)-[a-zA-Z]*R[a-zA-Z]*(?:\s|$)/.test(s.text),
    reason: 'recursive permission or ownership change'
  },
  {
    test: (s) => (s.command === 'mv' || s.command === 'cp') && /(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?:\s|$)/.test(s.text),
    reason: 'forced move or overwrite'
  },
  {
    test: (s) => s.command === 'killall' || s.command === 'pkill' || /\bkill\s+-9\s+-1\b/.test(s.text),
    reason: 'mass process termination'
  },
  {
    // Inspecting services is what an agent does while debugging; only mutations are worth a prompt.
    test: (s) =>
      ['launchctl', 'systemctl', 'crontab', 'service'].includes(s.command) && !READ_ONLY_SERVICE_ARG.test(s.text),
    reason: 'system service or scheduled-job change'
  },
  {
    test: (s) => s.command === 'docker' && /\b(?:system\s+prune|volume\s+rm|rm\s+-f)\b/.test(s.text),
    reason: 'docker resource removal'
  },
  {
    test: (s) =>
      ['npm', 'pnpm', 'yarn'].includes(s.command) && /\bpublish\b/.test(s.text) && !/\s--dry-run\b/.test(s.text),
    reason: 'package publish'
  },
  {
    // Bash is opaque to the workspace containment check that gates the file tools, so a command that
    // names the user's home explicitly is the one shape worth intercepting: `cat ~/.ssh/config`,
    // `sed -i ~/.zshrc`, `>> $HOME/.config/…`. It catches the common case, not every escape.
    // The trailing slash is what separates a path from a mention — `echo $HOME` and `rg '\$HOME' src`
    // read or print the variable and have no business being interrupted.
    test: (s) => /(?:^|[\s'"=<>|])(?:~|\$HOME|\$\{HOME\})\//.test(s.text),
    reason: 'command reaching into the home directory'
  },
  {
    test: (s) => s.elevated,
    reason: 'privilege escalation (sudo)'
  }
]

/** Resolve one pipeline stage's command word, looking through `VAR=x`, `sudo`, and wrappers. */
function parseStage(text: string, shell: 'bash' | 'powershell'): Stage {
  const input = shell === 'powershell' ? text.trim().replace(/^&/, '& ') : text.trim()
  const tokens = splitShellSegments(input, /^\s+/, shell)
    .map((token) => {
      let word = ''
      let quote: "'" | '"' | undefined
      for (let index = 0; index < token.length; index++) {
        const char = token[index]
        if (quote !== "'" && char === (shell === 'bash' ? '\\' : '`') && token[index + 1] !== undefined) {
          const next = token[++index]
          if (next !== '\n') word += next
        } else if (shell === 'powershell' && quote === "'" && char === "'" && token[index + 1] === "'") {
          word += "'"
          index++
        } else if (quote) {
          if (char === quote) quote = undefined
          else word += char
        } else if (char === "'" || char === '"') {
          quote = char
        } else {
          word += char
        }
      }
      return { word, quoted: token.startsWith("'") || token.startsWith('"') }
    })
    .filter((token) => token.word)
  let elevated = false
  let index = 0
  while (index < tokens.length) {
    if (shell === 'powershell' && tokens[index].quoted && !['&', '.'].includes(tokens[index - 1]?.word)) {
      return { command: '', text, elevated }
    }
    const token = tokens[index].word
    if (shell === 'powershell' && ['&', '.'].includes(token)) {
      index++
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index++
      continue
    }
    const word = token.replace(shell === 'powershell' ? /^.*[\\/]/ : /^.*\//, '').toLowerCase()
    const name = shell === 'powershell' ? word.replace(/\.exe$/i, '') : word
    if (name === 'sudo' || name === 'doas') {
      elevated = true
      index++
      continue
    }
    if (WRAPPERS.has(name) || RESERVED_WORDS[shell].has(name)) {
      index++
      continue
    }
    return { command: name, text, elevated }
  }
  return { command: '', text, elevated }
}

/**
 * Returns a short human reason when `command` looks irreversibly destructive, or `null` otherwise.
 * Each `&&`/`||`/`;`/newline segment is parsed on its own so a flag in one command is never
 * attributed to a keyword in another.
 */
export function detectDestructiveCommand(command: string, shell: 'bash' | 'powershell' = 'bash'): string | null {
  if (hasAmbiguousShellSyntax(command, shell)) return 'unparseable shell command requires approval'
  const separator = shell === 'powershell' ? /^(?:&&|\|\||[;\n]|(?=&))/ : /^(?:&&|\|\||[&;\n])/
  if (shell === 'powershell') {
    for (const segment of splitShellSegments(command, separator, shell)) {
      const stages = splitShellSegments(segment, /^\|/, shell).map((stage) => parseStage(stage, shell))
      if (
        stages.some((s) =>
          ['iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'curl', 'wget'].includes(s.command)
        ) &&
        stages.some((s) => ['iex', 'invoke-expression'].includes(s.command))
      )
        return 'remote script piped into PowerShell'
      for (const s of stages) {
        if (['remove-item', 'ri', 'del', 'erase', 'rm', 'rd', 'rmdir'].includes(s.command))
          return 'PowerShell file deletion'
        if (
          [
            'clear-disk',
            'format-volume',
            'initialize-disk',
            'remove-partition',
            'stop-computer',
            'restart-computer'
          ].includes(s.command)
        )
          return 'PowerShell system operation'
        if (s.command === 'stop-process' && /(?:^|\s)-force\b/i.test(s.text)) return 'forced process termination'
        if (s.command === 'reg' && /\s+delete\b/i.test(s.text)) return 'registry deletion'
        if (s.command === 'cmd' && /\s+\/c\s+(?:rd|del|format)\b/i.test(s.text)) return 'destructive cmd operation'
      }
    }
  }
  for (const segment of splitShellSegments(command, separator, shell)) {
    if (!segment.trim()) continue
    const stages = splitShellSegments(segment, /^\|/, shell).map((stage) => parseStage(stage, shell))

    // Piping a download into an interpreter is arbitrary remote code execution.
    const fetches = stages.some((stage) => stage.command === 'curl' || stage.command === 'wget')
    if (fetches && stages.some((stage) => SHELLS.has(stage.command))) {
      return 'remote script piped into a shell'
    }

    for (const stage of stages) {
      for (const rule of RULES) {
        if (rule.test(stage)) return rule.reason
      }
    }
  }
  return null
}
