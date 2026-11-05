import { parseShellCommand, type ShellCommand, type ShellHeredoc } from './shellCommandParser'

const MAX_ANALYSIS_DEPTH = 4

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish'])
const PYTHON = new Set(['python', 'python3', 'py'])
const NODE = new Set(['node', 'nodejs'])
const POWERSHELL = new Set(['powershell', 'pwsh'])
const CMD = new Set(['cmd'])

const UNIX_DELETION = new Set(['rm', 'unlink', 'shred', 'srm'])
const WINDOWS_DELETION = new Set(['remove-item', 'clear-content', 'del', 'erase', 'rd', 'rmdir'])

const DISK_COMMANDS = new Set([
  'wipefs',
  'fdisk',
  'cfdisk',
  'sfdisk',
  'diskpart',
  'format-volume',
  'clear-disk',
  'initialize-disk'
])
const DATABASES = new Set(['sqlite3', 'mysql', 'mariadb', 'psql', 'mongo', 'mongosh'])
const SHUTDOWN_COMMANDS = new Set(['shutdown', 'reboot', 'poweroff', 'halt', 'stop-computer', 'restart-computer'])

const SQL_DESTRUCTIVE = /\b(?:drop\s+(?:database|schema|table)|truncate\s+table|delete\s+from)\b/i
const LARK_FORM_SUBMISSION_PATTERN =
  /(?:^|[\s;&|])(?:"[^"\r\n]*lark-cli"|'[^'\r\n]*lark-cli'|[^\s;&|]*lark-cli)\s+base\s+\+form-submit(?:\s|$)/i
const GITHUB_ISSUE_CREATION_PATTERN =
  /(?:^\s*|[;&|]\s*|\r?\n\s*)(?:"(?:[^"\r\n]*[\\/])?gh(?:\.exe)?"|'(?:[^'\r\n]*[\\/])?gh(?:\.exe)?'|(?:[^\s;&|]*[\\/])?gh(?:\.exe)?)\s+issue\s+create(?:\s|$)/i
const PYTHON_DELETION = /\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree)\b|\.(?:unlink|rmdir)\s*\(/
const NODE_DELETION = /\bfs\.(?:rm|unlink|rmdir)(?:Sync)?\b|\b(?:rm|unlink|rmdir)Sync\s*\(/

const POWERSHELL_VALUE_FLAGS = new Set([
  '-executionpolicy',
  '-windowstyle',
  '-version',
  '-inputformat',
  '-outputformat',
  '-workingdirectory',
  '-psconsolefile',
  '-configurationname',
  '-custompipename'
])

const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--exec-path',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env'
])

const SSH_VALUE_FLAGS = new Set([
  '-B',
  '-b',
  '-c',
  '-D',
  '-E',
  '-e',
  '-F',
  '-I',
  '-i',
  '-J',
  '-L',
  '-l',
  '-m',
  '-O',
  '-o',
  '-p',
  '-Q',
  '-R',
  '-S',
  '-W',
  '-w'
])
const CHROOT_VALUE_FLAGS = new Set(['--userspec', '--groups'])
const KUBECTL_VALUE_FLAGS = new Set([
  '-c',
  '--container',
  '-n',
  '--namespace',
  '--context',
  '--kubeconfig',
  '--cluster',
  '--user'
])
const CONTAINER_EXEC_VALUE_FLAGS = new Set([
  '-e',
  '--env',
  '-u',
  '--user',
  '-w',
  '--workdir',
  '--detach-keys',
  '--env-file'
])
/** Common `docker run`/`podman run` options that consume the following argument. */
const CONTAINER_RUN_VALUE_FLAGS = new Set([
  '-a',
  '--attach',
  '--add-host',
  '--cap-add',
  '--cap-drop',
  '--cgroup-parent',
  '--cidfile',
  '--cpus',
  '--device',
  '--dns',
  '--dns-option',
  '--dns-search',
  '-e',
  '--env',
  '--env-file',
  '--entrypoint',
  '--expose',
  '--gpus',
  '--group-add',
  '--hostname',
  '-h',
  '--ipc',
  '--label',
  '-l',
  '--log-driver',
  '--log-opt',
  '--memory',
  '-m',
  '--mount',
  '--name',
  '--network',
  '--net',
  '-p',
  '--publish',
  '--platform',
  '--restart',
  '--runtime',
  '--security-opt',
  '--shm-size',
  '--tmpfs',
  '--ulimit',
  '-u',
  '--user',
  '-v',
  '--volume',
  '--volumes-from',
  '-w',
  '--workdir'
])

/** Replace string literals and comments with spaces so patterns match code, not prose. */
function stripScriptLiterals(code: string, language: 'python' | 'javascript'): string {
  let output = ''
  let index = 0
  while (index < code.length) {
    const char = code[index]
    if (char === "'" || char === '"' || (language === 'javascript' && char === '`')) {
      const triple = language === 'python' && code.startsWith(char.repeat(3), index)
      const quote = triple ? char.repeat(3) : char
      const close = findClosingQuote(code, index + quote.length, quote)
      output += ' '
      index = close === -1 ? code.length : close + quote.length
      continue
    }
    if (language === 'python' && char === '#') {
      const newline = code.indexOf('\n', index)
      output += ' '
      index = newline === -1 ? code.length : newline
      continue
    }
    if (language === 'javascript' && char === '/' && code[index + 1] === '/') {
      const newline = code.indexOf('\n', index)
      output += ' '
      index = newline === -1 ? code.length : newline
      continue
    }
    if (language === 'javascript' && char === '/' && code[index + 1] === '*') {
      const close = code.indexOf('*/', index + 2)
      output += ' '
      index = close === -1 ? code.length : close + 2
      continue
    }
    output += char
    index++
  }
  return output
}

function findClosingQuote(code: string, start: number, quote: string): number {
  let index = start
  while (index < code.length) {
    if (code[index] === '\\') {
      index += 2
      continue
    }
    if (code.startsWith(quote, index)) return index
    index++
  }
  return -1
}

function detectPythonDeletion(code: string): string | undefined {
  return PYTHON_DELETION.test(stripScriptLiterals(code, 'python')) ? 'scripted permanent file deletion' : undefined
}

function detectNodeDeletion(code: string): string | undefined {
  return NODE_DELETION.test(stripScriptLiterals(code, 'javascript')) ? 'scripted permanent file deletion' : undefined
}

function optionValue(args: readonly string[], flags: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    if (flags.includes(args[index]) && args[index + 1] !== undefined) return args[index + 1]
  }
  return undefined
}

/** Shell code flag, including combined short flags such as `bash -lc '…'`. */
function shellCodeArgument(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(args[index]) && args[index + 1] !== undefined) return args[index + 1]
  }
  return undefined
}

function decodePowerShellBase64(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return Buffer.from(value, 'base64').toString('utf16le')
  } catch {
    return undefined
  }
}

function powershellCommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const flag = args[index].toLowerCase()
    if (flag === '-encodedcommand' || flag === '-enc' || flag === '-ec') {
      return decodePowerShellBase64(args[index + 1])
    }
    if (flag === '-command' || flag === '-c') return args[index + 1]
  }
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    const flag = args[index].toLowerCase()
    if (flag === '-file') return undefined
    index += POWERSHELL_VALUE_FLAGS.has(flag) ? 2 : 1
  }
  return index < args.length ? args.slice(index).join(' ') : undefined
}

function cmdCommand(args: readonly string[]): string | undefined {
  const flagIndex = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
  return flagIndex >= 0 && args[flagIndex + 1] !== undefined ? args.slice(flagIndex + 1).join(' ') : undefined
}

function skipOptions(args: readonly string[], start: number, valueFlags: ReadonlySet<string>): number {
  let index = start
  while (index < args.length && args[index].startsWith('-') && args[index] !== '-') {
    index += valueFlags.has(args[index]) ? 2 : 1
  }
  return index
}

/** `ssh [options] destination [command]` — the first positional is the host, the rest run remotely. */
function sshCommand(args: readonly string[]): string | undefined {
  const destination = skipOptions(args, 0, SSH_VALUE_FLAGS)
  return args.slice(destination + 1).join(' ') || undefined
}

function suCommand(args: readonly string[]): string | undefined {
  const flagIndex = args.findIndex((arg) => arg === '-c' || arg === '--command')
  return flagIndex >= 0 && args[flagIndex + 1] !== undefined ? args[flagIndex + 1] : undefined
}

/** `chroot [options] newroot [command]` */
function chrootCommand(args: readonly string[]): string | undefined {
  const root = skipOptions(args, 0, CHROOT_VALUE_FLAGS)
  return args.slice(root + 1).join(' ') || undefined
}

/** `kubectl exec … [--] command` */
function kubectlCommand(args: readonly string[]): string | undefined {
  if (args[0] !== 'exec') return undefined
  const separator = args.indexOf('--')
  if (separator >= 0) return args.slice(separator + 1).join(' ') || undefined
  const container = skipOptions(args, 1, KUBECTL_VALUE_FLAGS)
  return args.slice(container + 1).join(' ') || undefined
}

/** `docker|podman exec … container command` / `run … image command` */
function containerCommand(args: readonly string[]): string | undefined {
  if (args[0] !== 'exec' && args[0] !== 'run') return undefined
  const options = args[0] === 'exec' ? CONTAINER_EXEC_VALUE_FLAGS : CONTAINER_RUN_VALUE_FLAGS
  const positional = skipOptions(args, 1, options)
  return args.slice(positional + 1).join(' ') || undefined
}

function isDeletionWord(word: string | undefined): boolean {
  if (!word) return false
  return UNIX_DELETION.has(word.replace(/^.*[\\/]/, '').toLowerCase())
}

function findDeletes(args: readonly string[]): boolean {
  return args.some(
    (arg, index) => arg === '-delete' || ((arg === '-exec' || arg === '-execdir') && isDeletionWord(args[index + 1]))
  )
}

function isDiskOperation(name: string, args: readonly string[]): boolean {
  if (name.startsWith('mkfs')) return true
  if (DISK_COMMANDS.has(name)) return true
  if (name === 'format') return /^[a-z]:/i.test(args[0] ?? '')
  if (name === 'diskutil') return args.some((arg) => /^(?:eraseDisk|eraseVolume|partitionDisk)$/i.test(arg))
  if (name === 'dd') return args.some((arg) => /^of=\/dev\//i.test(arg))
  return false
}

function gitReason(args: readonly string[]): string | undefined {
  let index = 0
  let subcommand: string | undefined
  while (index < args.length) {
    const arg = args[index]
    if (GIT_VALUE_OPTIONS.has(arg)) {
      index += 2
      continue
    }
    if (arg.startsWith('-')) {
      index++
      continue
    }
    subcommand = arg.toLowerCase()
    index++
    break
  }
  if (!subcommand) return undefined
  const rest = args.slice(index)
  let destructive = false
  switch (subcommand) {
    case 'clean':
      destructive = true
      break
    case 'restore':
      // `--staged` alone only unstages; adding `--worktree` discards edits again.
      destructive = !rest.includes('--staged') || rest.includes('--worktree')
      break
    case 'reset':
      destructive = rest.includes('--hard')
      break
    case 'checkout':
      destructive = rest.includes('--') || rest.includes('.') || rest.includes('-f') || rest.includes('--force')
      break
    case 'switch':
      destructive = rest.includes('--discard-changes') || rest.includes('-f') || rest.includes('--force')
      break
    case 'branch':
      destructive = rest.includes('-D')
      break
    case 'stash':
      destructive = rest[0] === 'drop' || rest[0] === 'clear'
      break
  }
  return destructive ? 'discarding version-control data' : undefined
}

function isInfrastructureDeletion(name: string, args: readonly string[]): boolean {
  if (name === 'terraform') return args[0] === 'destroy'
  if (name === 'kubectl') return args[0] === 'delete'
  if (name === 'helm') return args[0] === 'uninstall'
  if (name === 'docker') {
    return (
      args[0] === 'prune' ||
      args[0] === 'rm' ||
      args[0] === 'rmi' ||
      (args[0] === 'system' && args[1] === 'prune') ||
      (args[0] === 'volume' && args[1] === 'rm')
    )
  }
  if (name === 'aws' || name === 'gcloud' || name === 'az') {
    return args.some((arg) => ['delete', 'destroy', 'remove'].includes(arg.toLowerCase()))
  }
  return false
}

function isSystemDestruction(name: string, args: readonly string[]): boolean {
  if (SHUTDOWN_COMMANDS.has(name)) return true
  if (name === 'systemctl') return ['disable', 'mask'].includes(args[0]?.toLowerCase() ?? '')
  if (name === 'launchctl') return ['unload', 'remove'].includes(args[0]?.toLowerCase() ?? '')
  if (name === 'sc') return args[0]?.toLowerCase() === 'delete'
  if (name === 'reg') return args[0]?.toLowerCase() === 'delete'
  return false
}

function isHistoryErasure(name: string, args: readonly string[]): boolean {
  if (name === 'history') return args.includes('-c')
  if (name === 'clear-history') return true
  if (name === 'wevtutil') return args[0]?.toLowerCase() === 'cl'
  if (name === 'journalctl') return args.some((arg) => arg.startsWith('--vacuum'))
  return false
}

function analyzeNested(command: string | undefined, depth: number): string | undefined {
  return command === undefined ? undefined : analyze(command, depth + 1)
}

function reasonForNestedCommand(name: string, args: readonly string[], depth: number): string | undefined {
  if (depth >= MAX_ANALYSIS_DEPTH) return undefined
  if (SHELLS.has(name)) return analyzeNested(shellCodeArgument(args), depth)
  if (PYTHON.has(name)) {
    const code = optionValue(args, ['-c'])
    return code === undefined ? undefined : detectPythonDeletion(code)
  }
  if (NODE.has(name)) {
    const code = optionValue(args, ['-e', '--eval', '-p', '--print'])
    return code === undefined ? undefined : detectNodeDeletion(code)
  }
  if (POWERSHELL.has(name)) return analyzeNested(powershellCommand(args), depth)
  if (CMD.has(name)) return analyzeNested(cmdCommand(args), depth)
  if (name === 'ssh') return analyzeNested(sshCommand(args), depth)
  if (name === 'su' || name === 'runuser') return analyzeNested(suCommand(args), depth)
  if (name === 'chroot') return analyzeNested(chrootCommand(args), depth)
  if (name === 'kubectl') return analyzeNested(kubectlCommand(args), depth)
  if (name === 'docker' || name === 'podman') return analyzeNested(containerCommand(args), depth)
  return undefined
}

function reasonForCommand(command: ShellCommand, depth: number): string | undefined {
  const { command: name, args } = command
  if (UNIX_DELETION.has(name)) return 'permanent file deletion'
  if (WINDOWS_DELETION.has(name)) return 'permanent Windows file deletion'

  const scripted = reasonForNestedCommand(name, args, depth)
  if (scripted) return scripted

  if (name === 'find' && findDeletes(args)) return 'recursive find deletion'
  if (isDiskOperation(name, args)) return 'disk formatting or wiping'
  if (name === 'git') {
    const reason = gitReason(args)
    if (reason) return reason
  }
  if (DATABASES.has(name) && SQL_DESTRUCTIVE.test(args.join(' '))) return 'destructive database operation'
  if (isInfrastructureDeletion(name, args)) return 'destructive infrastructure operation'
  if (isSystemDestruction(name, args)) return 'system shutdown or service destruction'
  if (isHistoryErasure(name, args)) return 'security-log or shell-history erasure'
  return undefined
}

/** Whether an interpreter with these arguments executes its standard input as code. */
function readsStandardInput(name: string, args: readonly string[]): boolean {
  if (!SHELLS.has(name) && !PYTHON.has(name) && !NODE.has(name)) return false
  for (const arg of args) {
    if (arg === '-') continue
    if (arg.startsWith('-')) {
      if (SHELLS.has(name) && /^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) return false
      if (PYTHON.has(name) && arg === '-c') return false
      if (NODE.has(name) && ['-e', '--eval', '-p', '--print'].includes(arg)) return false
      continue
    }
    return false
  }
  return true
}

function reasonForHeredoc(heredoc: ShellHeredoc, depth: number): string | undefined {
  if (depth >= MAX_ANALYSIS_DEPTH) return undefined
  const { pipelines } = parseShellCommand(heredoc.line)
  for (const pipeline of pipelines) {
    for (const command of pipeline.commands) {
      if (!readsStandardInput(command.command, command.args)) continue
      if (SHELLS.has(command.command)) return analyze(heredoc.body, depth + 1)
      if (PYTHON.has(command.command)) return detectPythonDeletion(heredoc.body)
      if (NODE.has(command.command)) return detectNodeDeletion(heredoc.body)
    }
  }
  return undefined
}

function analyze(command: string, depth: number): string | undefined {
  if (depth > MAX_ANALYSIS_DEPTH) return undefined
  const parsed = parseShellCommand(command)
  for (const pipeline of parsed.pipelines) {
    for (const simple of pipeline.commands) {
      const reason = reasonForCommand(simple, depth)
      if (reason) return reason
      for (const substitution of simple.substitutions) {
        const nested = analyze(substitution, depth + 1)
        if (nested) return nested
      }
    }
  }
  for (const heredoc of parsed.heredocs) {
    const reason = reasonForHeredoc(heredoc, depth)
    if (reason) return reason
  }
  return undefined
}

export function detectDestructiveAssistantCommand(command: string): string | undefined {
  const normalized = command.replace(/\\\r?\n|\^\r?\n|`\r?\n/g, ' ')
  // A fork bomb is a shell construct, not a command with arguments; tokenizing would split it apart.
  if (/:\(\)\s*\{[^}]*:\|:&\s*;?\s*\}\s*;?\s*:/.test(normalized)) return 'a process-exhaustion payload'
  return analyze(normalized, 0)
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
