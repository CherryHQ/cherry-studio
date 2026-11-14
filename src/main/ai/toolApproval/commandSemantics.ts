import type { CommandAnalysis, CommandHeredoc, CommandWord, ExecutableCommand } from './commandParser'

export interface CommandSemantics {
  node: ExecutableCommand
  executable: string
  args: CommandWord[]
  subcommands: string[]
  options: Map<string, string | true>
  operands: string[]
  elevated: boolean
  incomplete: boolean
  repositoryDirectory?: string
  gitConfigurations: string[]
  gitGlobalOptions: Map<string, string | true>
  wrappers: { executable: string; args: string[]; directory?: string; incomplete?: boolean }[]
  executionBoundary?: string
  workingDirectory?: string
  inline?: { language: string; code?: string; word: CommandWord }
}

const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  sudo: [
    '-u',
    '--user',
    '-g',
    '--group',
    '-p',
    '--prompt',
    '-C',
    '--close-from',
    '-T',
    '-r',
    '-t',
    '-U',
    '-D',
    '--chdir',
    '--host'
  ],
  doas: ['-u', '-C'],
  pkexec: ['--user'],
  time: ['-f', '--format', '-o', '--output'],
  exec: ['-a'],
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string', '--argv0'],
  nice: ['-n', '--adjustment'],
  ionice: ['-c', '--class', '-n', '--classdata', '-p', '--pid'],
  stdbuf: ['-i', '--input', '-o', '--output', '-e', '--error'],
  xargs: [
    '-n',
    '--max-args',
    '-I',
    '--replace',
    '-P',
    '--max-procs',
    '-L',
    '--max-lines',
    '-s',
    '--max-chars',
    '-d',
    '--delimiter',
    '-E',
    '-e',
    '-a',
    '--arg-file'
  ],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  command: [],
  builtin: [],
  nohup: [],
  busybox: [],
  toybox: [],
  rtk: []
}
const WRAPPER_FLAGS: Readonly<Record<string, readonly string[]>> = {
  sudo: ['-A', '-b', '-E', '-H', '-k', '-K', '-n', '-P', '-S', '-v', '-V'],
  doas: ['-n', '-s', '-L'],
  pkexec: ['--disable-internal-agent'],
  time: ['-p', '-a', '-v'],
  exec: ['-c', '-l'],
  env: ['-i', '--ignore-environment', '-0', '--null'],
  nice: [],
  ionice: ['-t', '--ignore'],
  stdbuf: [],
  xargs: ['-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p', '--interactive', '-x', '--exit'],
  timeout: ['--preserve-status', '--foreground', '-v', '--verbose'],
  command: ['-p'],
  builtin: [],
  nohup: [],
  busybox: [],
  toybox: [],
  rtk: []
}
const PACKAGE_GLOBAL_FLAGS = new Set([
  '--dry-run',
  '--no-dry-run',
  '--global',
  '-g',
  '--silent',
  '-s',
  '--quiet',
  '-q',
  '--verbose',
  '--version',
  '-v',
  '--help',
  '-h'
])
const GIT_GLOBAL_VALUES = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env'
])
const GIT_GLOBAL_FLAGS = new Set([
  '--bare',
  '--no-pager',
  '--paginate',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--no-optional-locks',
  '--no-lazy-fetch',
  '--version',
  '--help',
  '-h'
])
const OPTION_VALUES: Readonly<Record<string, readonly string[]>> = {
  reset: ['--pathspec-from-file'],
  push: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
  checkout: ['-b', '-B', '--orphan', '--conflict', '--pathspec-from-file'],
  switch: ['-c', '-C', '--create', '--force-create', '--conflict'],
  restore: ['-s', '--source', '--pathspec-from-file', '--conflict'],
  clean: ['-e', '--exclude'],
  log: ['--format', '--pretty', '--author', '--grep', '--since', '--until', '-n', '--max-count'],
  publish: ['--tag', '--access', '--registry', '--otp', '--provenance-file']
}
const GIT_OPERATION_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  push: [
    '--force',
    '--force-with-lease',
    '--force-if-includes',
    '--no-force',
    '--no-force-with-lease',
    '--no-force-if-includes',
    '-u',
    '--set-upstream',
    '-d',
    '--delete',
    '--tags',
    '--all',
    '--mirror',
    '--atomic',
    '-n',
    '--dry-run',
    '-v',
    '--verbose',
    '-q',
    '--quiet',
    '--porcelain',
    '--progress',
    '--no-verify',
    '--follow-tags',
    '--signed',
    '--recurse-submodules',
    '--thin',
    '--no-thin'
  ],
  reset: [
    '--hard',
    '--soft',
    '--mixed',
    '--merge',
    '--keep',
    '-q',
    '--quiet',
    '--recurse-submodules',
    '--no-recurse-submodules',
    '-p',
    '--patch',
    '-N',
    '--intent-to-add',
    '--pathspec-from-file',
    '--pathspec-file-nul'
  ],
  checkout: [
    '--force',
    '-b',
    '-B',
    '--orphan',
    '-t',
    '--track',
    '--no-track',
    '--detach',
    '-m',
    '--merge',
    '-p',
    '--patch',
    '-q',
    '--quiet',
    '--progress',
    '--no-progress',
    '--ours',
    '--theirs',
    '--ignore-skip-worktree-bits',
    '--pathspec-file-nul',
    '--recurse-submodules',
    '--no-recurse-submodules',
    '--overlay',
    '--no-overlay'
  ],
  switch: [
    '--discard-changes',
    '-c',
    '-C',
    '--create',
    '--force-create',
    '--detach',
    '-d',
    '-m',
    '--merge',
    '--orphan',
    '-q',
    '--quiet',
    '-t',
    '--track',
    '--no-track',
    '--guess',
    '--no-guess',
    '--recurse-submodules',
    '--no-recurse-submodules'
  ],
  restore: [
    '--staged',
    '--worktree',
    '-p',
    '--patch',
    '--ours',
    '--theirs',
    '-m',
    '--merge',
    '--ignore-unmerged',
    '--ignore-skip-worktree-bits',
    '--pathspec-file-nul',
    '-q',
    '--quiet',
    '--progress',
    '--no-progress',
    '--overlay',
    '--no-overlay',
    '--recurse-submodules',
    '--no-recurse-submodules'
  ],
  clean: ['--force', '--dry-run', '-d', '-x', '-X', '-i', '--interactive', '-q', '--quiet']
}
const ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  push: { '-f': '--force' },
  checkout: { '-f': '--force' },
  clean: { '-f': '--force', '-n': '--dry-run' },
  restore: { '-S': '--staged', '-W': '--worktree' },
  switch: { '-f': '--discard-changes' }
}

export function executableName(value: string, insensitive = false): string {
  const name = value.replace(/\\/g, '/').split('/').at(-1) ?? value
  return (insensitive ? name.toLowerCase() : name).replace(/\.exe$/, '')
}

export function resolveCommandWords(
  words: readonly string[],
  insensitive = false
):
  | { command: string; args: string[]; offset: number; elevated: boolean; wrappers: CommandSemantics['wrappers'] }
  | undefined {
  let index = 0
  let elevated = false
  const wrappers: CommandSemantics['wrappers'] = []
  while (index < words.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
      index++
      continue
    }
    const name = executableName(words[index], insensitive)
    if (!(name in WRAPPERS)) return { command: name, args: words.slice(index + 1), offset: index, elevated, wrappers }
    elevated ||= ['sudo', 'doas', 'pkexec'].includes(name)
    const start = index++
    let incomplete = false
    if (['command', 'builtin'].includes(name) && ['-v', '-V'].includes(words[index])) return undefined
    while (index < words.length && words[index].startsWith('-') && words[index] !== '-') {
      if (words[index] === '--') {
        index++
        break
      }
      const option = words[index].split('=')[0]
      const attached = option.length > 2 && !option.startsWith('--') && WRAPPERS[name].includes(option.slice(0, 2))
      if (!attached && !WRAPPERS[name].includes(option) && !WRAPPER_FLAGS[name]?.includes(option)) incomplete = true
      index += WRAPPERS[name].includes(option) && !words[index].includes('=') ? 2 : 1
    }
    if (name === 'timeout') index++
    const args = words.slice(start + 1, index)
    const directoryIndex = args.findIndex((arg) => ['-C', '-D', '--chdir'].includes(arg))
    const attachedDirectory =
      args.find((arg) => arg.startsWith('--chdir='))?.slice(8) ?? args.find((arg) => /^-[CD].+/.test(arg))?.slice(2)
    const directory = directoryIndex >= 0 ? args[directoryIndex + 1] : attachedDirectory
    wrappers.push({ executable: name, args, incomplete, ...(directory !== undefined ? { directory } : {}) })
  }
  return undefined
}

export function canonicalOption(command: CommandSemantics, option: string): string {
  return ALIASES[command.subcommands[0]]?.[option] ?? option
}

export function interpretCommand(node: ExecutableCommand): CommandSemantics | undefined {
  const values = node.words.map((word) => word.value ?? word.raw)
  const resolved = resolveCommandWords(values, node.dialect === 'powershell')
  if (!resolved) return undefined
  const result: CommandSemantics = {
    node,
    executable: resolved.command,
    args: node.words.slice(resolved.offset + 1),
    subcommands: [],
    options: new Map(),
    operands: [],
    elevated: resolved.elevated,
    gitConfigurations: [],
    gitGlobalOptions: new Map(),
    wrappers: resolved.wrappers,
    incomplete:
      node.words[resolved.offset]?.value === undefined || resolved.wrappers.some((wrapper) => wrapper.incomplete)
  }
  for (const wrapper of result.wrappers.filter(({ executable }) => executable === 'xargs')) {
    const replaceIndex = wrapper.args.findIndex((arg) => arg === '-I' || arg === '--replace')
    const replacement =
      replaceIndex >= 0
        ? wrapper.args[replaceIndex + 1]
        : (wrapper.args.find((arg) => arg.startsWith('-I'))?.slice(2) ??
          wrapper.args.find((arg) => arg.startsWith('--replace='))?.slice(10))
    if (replacement && result.executable.includes(replacement)) result.incomplete = true
  }
  const packageManager = ['npm', 'pnpm', 'yarn'].includes(result.executable)
  const setOption = (option: string, argument: string | true) => {
    if (packageManager && (option === '--dry-run' || option === '--no-dry-run')) {
      if (option === '--no-dry-run' || ['false', '0'].includes(String(argument))) result.options.delete('--dry-run')
      else result.options.set('--dry-run', argument)
    } else result.options.set(option, argument)
  }
  let index = 0
  if (result.executable === 'git') {
    while (index < result.args.length && result.args[index].value?.startsWith('-')) {
      const value = result.args[index].value!
      const [option, attached] = value.split(/=(.*)/s)
      const shortAttached =
        value.length > 2 && (value.startsWith('-C') || value.startsWith('-c')) ? value.slice(2) : undefined
      const name = shortAttached ? value.slice(0, 2) : option
      if (GIT_GLOBAL_VALUES.has(name)) {
        const argument = attached ?? shortAttached ?? result.args[++index]?.value
        if (argument === undefined || argument === '') result.incomplete = true
        result.gitGlobalOptions.set(name, argument ?? true)
        if (name === '-C') result.repositoryDirectory = argument
        if (name === '-c' && argument !== undefined) result.gitConfigurations.push(argument)
      } else if (GIT_GLOBAL_FLAGS.has(name) || name === '--exec-path')
        result.gitGlobalOptions.set(name, attached ?? true)
      else {
        result.incomplete = true
        break
      }
      index++
    }
  } else if (['npm', 'pnpm', 'yarn', 'docker', 'podman'].includes(result.executable)) {
    while (index < result.args.length && result.args[index].value?.startsWith('-')) {
      const value = result.args[index].value!
      const [option, attached] = value.split(/=(.*)/s)
      const takesValue = [
        '--prefix',
        '--dir',
        '-C',
        '--cwd',
        '--filter',
        '--workspace',
        '-w',
        '--registry',
        '-H',
        '--host',
        '--context',
        '--config',
        '--log-level',
        '--loglevel'
      ].includes(option)
      const argument = attached ?? (takesValue ? result.args[++index]?.value : true)
      if (argument === undefined || (packageManager && !takesValue && !PACKAGE_GLOBAL_FLAGS.has(option)))
        result.incomplete = true
      setOption(option, argument ?? true)
      index++
    }
  }
  const first = result.args[index]?.value
  const hasSubcommand = [
    'git',
    'npm',
    'pnpm',
    'yarn',
    'docker',
    'podman',
    'kubectl',
    'systemctl',
    'launchctl',
    'service',
    'sc',
    'reg'
  ].includes(result.executable)
  if (hasSubcommand && result.args[index] && first === undefined) result.incomplete = true
  if (first && !first.startsWith('-')) {
    result.subcommands.push(first)
    if (!hasSubcommand) result.operands.push(first)
    index++
  }
  const valueOptions = new Set(OPTION_VALUES[result.subcommands[0]] ?? [])
  let literal = false
  for (; index < result.args.length; index++) {
    const word = result.args[index]
    const value = word.value
    if (value === '--' && !literal) {
      literal = true
      continue
    }
    if (!literal && value?.startsWith('-') && value !== '-') {
      const [option, attached] = value.split(/=(.*)/s)
      if (option.startsWith('--')) {
        const argument = attached ?? (valueOptions.has(option) ? result.args[++index]?.value : true)
        if (argument === undefined) result.incomplete = true
        setOption(option, argument ?? true)
      } else {
        for (let offset = 1; offset < option.length; offset++) {
          const short = `-${option[offset]}`
          const name = canonicalOption(result, short)
          const argument = valueOptions.has(short) ? option.slice(offset + 1) || result.args[++index]?.value : true
          if (argument === undefined) result.incomplete = true
          result.options.set(name, argument ?? true)
          if (valueOptions.has(short)) break
        }
      }
    } else {
      if (value !== undefined) {
        result.operands.push(value)
        result.subcommands.push(value)
      } else if (['push', 'reset', 'restore', 'checkout', 'clean', 'publish'].includes(result.subcommands[0]))
        result.incomplete = true
    }
  }
  if (
    result.executable === 'git' &&
    result.subcommands[0] === 'checkout' &&
    result.operands.length === 1 &&
    !['-b', '-B', '--orphan', '--track', '-t'].some((option) => result.options.has(option)) &&
    !result.args.some(({ value }) => value === '--')
  )
    result.incomplete = true
  if (
    ['ssh', 'docker', 'podman', 'kubectl'].includes(result.executable) &&
    (result.executable === 'ssh' || result.subcommands.includes('exec') || result.subcommands.includes('run'))
  ) {
    result.executionBoundary = result.executable === 'ssh' ? 'remote' : 'container'
    result.incomplete = true
  }
  if (
    result.wrappers.some(
      ({ executable, args }) =>
        executable === 'env' && args.some((arg) => arg === '-S' || arg.startsWith('--split-string'))
    )
  )
    result.incomplete = true
  const known = result.executable === 'git' ? GIT_OPERATION_OPTIONS[result.subcommands[0]] : undefined
  if (known && [...result.options.keys()].some((option) => !known.includes(option) && !valueOptions.has(option)))
    result.incomplete = true
  const executable = result.executable
  const args = result.args
  const shells = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash']
  if (executable === 'eval') {
    const word = args[0]
    if (word)
      result.inline = {
        language: 'bash',
        code: args.every(({ value }) => value !== undefined) ? args.map(({ value }) => value).join(' ') : undefined,
        word
      }
    result.incomplete ||= !result.inline?.code
    return result
  }
  let scriptIndex = -1
  let language = executable
  if (shells.includes(executable)) {
    scriptIndex = args.findIndex(({ value }) => value !== undefined && /^-[a-z]*c[a-z]*$/.test(value)) + 1
    if (scriptIndex > 0) language = 'bash'
  } else if (['powershell', 'pwsh'].includes(executable)) {
    scriptIndex =
      args.findIndex(({ value }) =>
        ['-command', '-c', '-encodedcommand', '-enc', '-ec'].includes(value?.toLowerCase() ?? '')
      ) + 1
    language = 'powershell'
  } else if (
    ['node', 'nodejs', 'python', 'python3', 'py', 'ruby', 'perl', 'osascript', 'deno', 'bun'].includes(executable)
  ) {
    scriptIndex = args.findIndex(({ value }) => ['-c', '-e', '--eval', '-p', '--print'].includes(value ?? '')) + 1
  } else if (executable === 'fish') {
    scriptIndex = args.findIndex(({ value }) => value === '-c' || value === '--command') + 1
    result.incomplete = true
  } else if (executable === 'cmd') {
    scriptIndex = args.findIndex(({ value }) => ['/c', '/k'].includes(value?.toLowerCase() ?? '')) + 1
    language = 'cmd'
  }
  if (scriptIndex > 0) {
    const word = args[scriptIndex]
    if (!word) result.incomplete = true
    else {
      let code = word.value
      if (
        language === 'powershell' &&
        ['-encodedcommand', '-enc', '-ec'].includes(args[scriptIndex - 1].value?.toLowerCase() ?? '') &&
        code !== undefined
      ) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(code)) result.incomplete = true
        else code = Buffer.from(code, 'base64').toString('utf16le')
      }
      result.inline = { language, code, word }
      if (code === undefined || language === 'cmd') result.incomplete = true
    }
  }
  return result
}

export function discardsGitWorktree(command: CommandSemantics): boolean {
  if (command.executable !== 'git') return false
  const name = command.subcommands[0]
  const options = command.options
  if (name === 'reset') return options.has('--hard')
  if (name === 'clean') return options.has('--force') && !options.has('--dry-run')
  if (name === 'restore') return !options.has('--staged') || options.has('--worktree')
  if (name === 'switch') return options.has('--discard-changes') || options.has('-C') || options.has('--force-create')
  if (name !== 'checkout') return false
  if (options.has('--force') || options.has('-B')) return true
  if (options.has('-b') || options.has('--orphan')) return false
  return (
    command.operands.length > 1 ||
    command.args.some(({ value }) => value === '--') ||
    command.operands.some((value) => value === '.')
  )
}

/** Follow only a known byte-preserving cat stage; other programs do not prove where the body goes. */
export function findHeredocConsumer(analysis: CommandAnalysis, heredoc: CommandHeredoc): CommandSemantics | undefined {
  const pipeline = analysis.commands.filter((node) => node.pipeline === heredoc.pipeline)
  let index = pipeline.findIndex(
    (node) => node.range.start === heredoc.owner && node.range.source === heredoc.range.source
  )
  if (index < 0) return undefined
  while (index < pipeline.length) {
    const command = interpretCommand(pipeline[index++])
    if (!command) return undefined
    if (command.executable !== 'cat' || command.args.some(({ value }) => value !== '-' && value !== '-u'))
      return command
    if (index === pipeline.length) return command
  }
  return undefined
}
