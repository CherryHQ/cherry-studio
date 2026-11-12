import { parseShellCommand, resolveCommand, type ShellCommand, type ShellHeredoc } from './shellCommandParser'

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
/** Docker object types whose `rm`/`rmi`/`prune` subcommands destroy containers, images, or volumes. */
const CONTAINER_OBJECTS = new Set([
  'builder',
  'buildx',
  'config',
  'container',
  'context',
  'image',
  'network',
  'node',
  'plugin',
  'secret',
  'service',
  'stack',
  'swarm',
  'system',
  'volume'
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

/** Characters that can end a value, so a `/` after them divides instead of starting a pattern. */
const VALUE_ENDER = /[A-Za-z0-9_$)\]}.]/

/**
 * Index just past the regular expression starting at `start`, or `-1` when the `/` is division.
 * A character class holds `/`, `*`, and `#` literally: `/[/*]/` is a regex, never a comment.
 */
function findRegexLiteralEnd(code: string, start: number): number {
  let index = start + 1
  let inClass = false
  if (code[index] === '*' || code[index] === '/') return -1 // A comment or an empty pattern.
  while (index < code.length) {
    const char = code[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '\n') return -1
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) return index + 1
    index++
  }
  return -1
}

/**
 * Replace string literals and comments with spaces so patterns match code, not prose.
 *
 * The token before the slash is carried forward by the scan rather than read back from it: whether
 * a `/` divides depends on lexical context, and a `//` inside a string or on an earlier line is not
 * trivia standing between the operands.
 */
function stripScriptLiterals(code: string, language: 'python' | 'javascript'): string {
  let output = ''
  let index = 0
  let canDivide = false
  while (index < code.length) {
    const char = code[index]
    if (language === 'javascript' && char === '`') {
      const template = stripTemplateLiteral(code, index)
      output += template.output
      index = template.end
      canDivide = true
      continue
    }
    if (char === "'" || char === '"') {
      const triple = language === 'python' && code.startsWith(char.repeat(3), index)
      const quote = triple ? char.repeat(3) : char
      const close = findClosingQuote(code, index + quote.length, quote)
      output += ' '
      index = close === -1 ? code.length : close + quote.length
      canDivide = true
      continue
    }
    if (language === 'python' && char === '#') {
      const newline = code.indexOf('\n', index)
      output += ' '
      index = newline === -1 ? code.length : newline
      continue
    }
    if (language === 'javascript' && char === '/' && !canDivide) {
      const end = findRegexLiteralEnd(code, index)
      if (end !== -1) {
        output += ' '
        index = end
        canDivide = true
        continue
      }
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
    if (!/\s/.test(char)) canDivide = VALUE_ENDER.test(char)
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

/** Blank a template literal's text but keep its `${…}` expressions, which execute. */
function stripTemplateLiteral(code: string, start: number): { output: string; end: number } {
  let output = ' '
  let index = start + 1
  while (index < code.length) {
    const char = code[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '`') return { output, end: index + 1 }
    if (char === '$' && code[index + 1] === '{') {
      const end = findTemplateExpressionEnd(code, index + 1)
      const expression = code.slice(index + 2, end === -1 ? code.length : end)
      output += ` ${stripScriptLiterals(expression, 'javascript')}`
      index = end === -1 ? code.length : end + 1
      continue
    }
    index++
  }
  return { output, end: code.length }
}

/** Index of the `}` closing a `${` expression, skipping nested strings, templates, and regexes. */
function findTemplateExpressionEnd(code: string, braceStart: number): number {
  let depth = 0
  let index = braceStart
  let canDivide = false
  while (index < code.length) {
    const char = code[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      const close = findClosingQuote(code, index + 1, char)
      index = close === -1 ? code.length : close + 1
      canDivide = true
      continue
    }
    if (char === '`') {
      index = stripTemplateLiteral(code, index).end
      canDivide = true
      continue
    }
    // A brace inside a comment or a character class is not a brace: `${/[/*]/}` is a regex.
    if (char === '/' && !canDivide) {
      const end = findRegexLiteralEnd(code, index)
      if (end !== -1) {
        index = end
        canDivide = true
        continue
      }
    }
    if (char === '/' && code[index + 1] === '/') {
      const newline = code.indexOf('\n', index)
      index = newline === -1 ? code.length : newline + 1
      continue
    }
    if (char === '/' && code[index + 1] === '*') {
      const close = code.indexOf('*/', index + 2)
      index = close === -1 ? code.length : close + 2
      continue
    }
    if (char === '{') {
      depth++
      canDivide = false
      index++
      continue
    }
    if (char === '}') {
      depth--
      if (depth === 0) return index
      canDivide = true
      index++
      continue
    }
    if (!/\s/.test(char)) canDivide = VALUE_ENDER.test(char)
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
    if (flag === '-command' || flag === '-c') return args.slice(index + 1).join(' ')
  }
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    const flag = args[index].toLowerCase()
    if (flag === '-file') return undefined
    index += POWERSHELL_VALUE_FLAGS.has(flag) ? 2 : 1
  }
  return index < args.length ? args.slice(index).join(' ') : undefined
}

function cmdCommand(args: readonly string[], rawArgs?: readonly string[]): string | undefined {
  const flagIndex = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
  if (flagIndex < 0 || args[flagIndex + 1] === undefined) return undefined
  const values = args.slice(flagIndex + 1)
  const source = rawArgs?.slice(flagIndex + 1)
  const program = (source ?? values).join(' ')
  // CMD strips the first and last quote of its whole /c or /k program, even
  // when nested quotes caused the shell tokenizer to split it into words.
  if (source?.[0].startsWith('"')) {
    const lastQuote = program.lastIndexOf('"')
    if (lastQuote > 0) return program.slice(1, lastQuote) + program.slice(lastQuote + 1)
  }
  return program
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
function chrootArgv(args: readonly string[]): readonly string[] {
  const root = skipOptions(args, 0, CHROOT_VALUE_FLAGS)
  return args.slice(root + 1)
}

/** `kubectl exec … [--] command arg…` */
function kubectlArgv(args: readonly string[]): readonly string[] | undefined {
  if (args[0] !== 'exec') return undefined
  const separator = args.indexOf('--')
  if (separator >= 0) return args.slice(separator + 1)
  const container = skipOptions(args, 1, KUBECTL_VALUE_FLAGS)
  return args.slice(container + 1)
}

/** `docker|podman exec … container command arg…` / `run … image command arg…` */
function containerArgv(args: readonly string[]): readonly string[] | undefined {
  if (args[0] !== 'exec' && args[0] !== 'run') return undefined
  const options = args[0] === 'exec' ? CONTAINER_EXEC_VALUE_FLAGS : CONTAINER_RUN_VALUE_FLAGS
  const positional = skipOptions(args, 1, options)
  return args.slice(positional + 1)
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
    const [subcommand, action] = args
    if (subcommand === 'prune' || subcommand === 'rm' || subcommand === 'rmi') return true
    // `docker container rm`, `docker image rm`, `docker volume prune`, `docker system prune`, …
    return CONTAINER_OBJECTS.has(subcommand) && ['rm', 'rmi', 'prune'].includes(action ?? '')
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

/** These exec a vector, not shell text, so a `-c` program stays one argument. */
function analyzeArgv(argv: readonly string[] | undefined, depth: number): string | undefined {
  if (argv === undefined) return undefined
  const resolved = resolveCommand(argv)
  return resolved === undefined ? undefined : reasonForCommand({ ...resolved, substitutions: [] }, depth + 1)
}

function reasonForNestedCommand(
  name: string,
  args: readonly string[],
  depth: number,
  rawArgs?: readonly string[]
): string | undefined {
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
  if (POWERSHELL.has(name)) {
    const code = powershellCommand(args)
    return code === undefined ? undefined : analyze(code, depth + 1, true)
  }
  if (CMD.has(name)) return analyzeNested(cmdCommand(args, rawArgs), depth)
  if (name === 'ssh') return analyzeNested(sshCommand(args), depth)
  if (name === 'su' || name === 'runuser') return analyzeNested(suCommand(args), depth)
  if (name === 'chroot') return analyzeArgv(chrootArgv(args), depth)
  if (name === 'kubectl') return analyzeArgv(kubectlArgv(args), depth)
  if (name === 'docker' || name === 'podman') return analyzeArgv(containerArgv(args), depth)
  return undefined
}

function reasonForCommand(command: ShellCommand, depth: number): string | undefined {
  const { command: name, args } = command
  if (UNIX_DELETION.has(name)) return 'permanent file deletion'
  if (WINDOWS_DELETION.has(name)) return 'permanent Windows file deletion'

  const scripted = reasonForNestedCommand(name, args, depth, command.rawArgs)
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

/**
 * `$(…)` and backtick expansions an unquoted heredoc evaluates before its consumer reads it. In a
 * heredoc body quotes and `#` are literal text, so `'$(rm -f victim)'` and `# $(rm -f victim)` still
 * execute; the raw scan catches those, and the parser's own substitutions resolve the nesting.
 */
function heredocExpansions(body: string): string[] {
  const { pipelines } = parseShellCommand(body)
  const parsed = pipelines.flatMap((pipeline) => pipeline.commands.flatMap((command) => command.substitutions))
  return [...new Set([...parsed, ...rawHeredocExpansions(body)])]
}

function rawHeredocExpansions(body: string): string[] {
  const expansions: string[] = []
  let index = 0
  while (index < body.length) {
    const char = body[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '$' && body[index + 1] === '(') {
      const end = findSubstitutionEnd(body, index + 1)
      expansions.push(body.slice(index + 2, end === -1 ? body.length : end))
      index = end === -1 ? body.length : end + 1
      continue
    }
    if (char === '`') {
      const close = body.indexOf('`', index + 1)
      expansions.push(body.slice(index + 1, close === -1 ? body.length : close))
      index = close === -1 ? body.length : close + 1
      continue
    }
    index++
  }
  return expansions
}

/** Index of the `)` closing a `$(`: parens nest, and the text inside the substitution still quotes. */
function findSubstitutionEnd(text: string, parenIndex: number): number {
  let depth = 0
  let index = parenIndex
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      const close = findClosingQuote(text, index + 1, char)
      index = close === -1 ? text.length : close + 1
      continue
    }
    if (char === '`') {
      const close = text.indexOf('`', index + 1)
      index = close === -1 ? text.length : close + 1
      continue
    }
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) return index
    }
    index++
  }
  return -1
}

function reasonForHeredoc(heredoc: ShellHeredoc, depth: number): string | undefined {
  if (depth >= MAX_ANALYSIS_DEPTH) return undefined
  const { pipelines } = parseShellCommand(heredoc.line)
  for (const pipeline of pipelines) {
    for (const command of pipeline.commands) {
      // `sqlite3 app.db <<'SQL'` executes the heredoc body as SQL.
      if (DATABASES.has(command.command) && SQL_DESTRUCTIVE.test(heredoc.body)) return 'destructive database operation'
      if (!readsStandardInput(command.command, command.args)) continue
      if (SHELLS.has(command.command)) return analyze(heredoc.body, depth + 1)
      if (PYTHON.has(command.command)) return detectPythonDeletion(heredoc.body)
      if (NODE.has(command.command)) return detectNodeDeletion(heredoc.body)
    }
  }
  // An unquoted delimiter (`<<EOF`) still evaluates expansions while `cat` ships the prose body.
  if (!heredoc.quoted) {
    for (const expansion of heredocExpansions(heredoc.body)) {
      const reason = analyze(expansion, depth + 1)
      if (reason) return reason
    }
  }
  return undefined
}

function analyze(command: string, depth: number, powershell = false): string | undefined {
  if (depth > MAX_ANALYSIS_DEPTH) return undefined
  const parsed = parseShellCommand(command, powershell)
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
