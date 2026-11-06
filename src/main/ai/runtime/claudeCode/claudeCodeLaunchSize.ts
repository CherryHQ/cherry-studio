import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeCodeLaunchInput = Pick<SpawnOptions, 'command' | 'args' | 'env' | 'cwd'>
export type ClaudeCodeLaunchSizeErrno = 'ENAMETOOLONG' | 'E2BIG'

export interface ClaudeCodeLaunchSize {
  errno: ClaudeCodeLaunchSizeErrno
  argvCount: number
  argvUtf16Units: number
  argvUtf8Bytes: number
  commandUtf16Units: number
  commandUtf8Bytes: number
  envEntryCount: number
  envBlockUtf16Units: number
  envStringsUtf8Bytes: number
  cwdUtf16Units: number
  cwdUtf8Bytes: number
  cwdInherited: boolean
  largestArgs: readonly { index: number; owner: string; utf16Units: number; utf8Bytes: number }[]
}

const valueFlags = new Set([
  '--mcp-config',
  '--settings',
  '--managed-settings',
  '--json-schema',
  '--tools',
  '--allowedTools',
  '--disallowedTools',
  '--add-dir',
  '--plugin-dir',
  '--plugin-dir-no-mcp',
  '--model',
  '--betas',
  '--effort',
  '--max-turns',
  '--max-thinking-tokens',
  '--max-budget-usd',
  '--permission-mode',
  '--permission-prompt-tool'
])
const flags = new Set([...valueFlags, '--include-partial-messages'])
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')

/** A structured code takes precedence over a spawn-shaped message. */
export function launchSizeErrno(error: unknown): ClaudeCodeLaunchSizeErrno | undefined {
  const object =
    error !== null && (typeof error === 'object' || typeof error === 'function')
      ? (error as { code?: unknown; message?: unknown })
      : undefined
  if (typeof object?.code === 'string')
    return object.code === 'ENAMETOOLONG' || object.code === 'E2BIG' ? object.code : undefined
  const message = typeof error === 'string' ? error : object?.message
  if (typeof message !== 'string') return undefined
  return /\bspawn\b[^\n]*\b(ENAMETOOLONG|E2BIG)\b/.exec(message)?.[1] as ClaudeCodeLaunchSizeErrno | undefined
}

/**
 * Input sizes are proxies: Windows quoting and terminators expand the UTF-16 command line;
 * POSIX byte limits also include pointer tables and kernel overhead omitted here.
 */
export function summarizeLaunchInput(
  input: ClaudeCodeLaunchInput,
  errno: ClaudeCodeLaunchSizeErrno
): ClaudeCodeLaunchSize {
  let pending: string | undefined
  let ended = false
  const entries = input.args.map((arg, index) => {
    let owner = '<unattributed>'
    if (pending) {
      owner = pending
      pending = undefined
    } else if (!ended && arg === '--') {
      ended = true
    } else if (!ended) {
      const equals = arg.indexOf('=')
      const flag = equals < 0 ? arg : arg.slice(0, equals)
      if (equals >= 0 && flags.has(flag)) owner = flag
      else if (equals < 0 && valueFlags.has(flag)) pending = flag
    }
    return { index, owner, utf16Units: arg.length, utf8Bytes: bytes(arg) }
  })
  const envKeys = Object.keys(input.env)
    .filter((key) => input.env[key] !== undefined)
    .sort()
  const seen = new Set<string>()
  const env = envKeys.filter((key) => {
    const normalized = key.toUpperCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
  const cwd = input.cwd ?? process.cwd()
  return {
    errno,
    argvCount: entries.length,
    argvUtf16Units: entries.reduce((sum, entry) => sum + entry.utf16Units, Math.max(0, entries.length - 1)),
    argvUtf8Bytes: entries.reduce((sum, entry) => sum + entry.utf8Bytes, Math.max(0, entries.length - 1)),
    commandUtf16Units: input.command.length,
    commandUtf8Bytes: bytes(input.command),
    envEntryCount: env.length,
    envBlockUtf16Units: Math.max(2, 1 + env.reduce((sum, key) => sum + key.length + input.env[key]!.length + 2, 0)),
    envStringsUtf8Bytes: env.reduce((sum, key) => sum + bytes(key) + bytes(input.env[key]!) + 2, 0),
    cwdUtf16Units: cwd.length,
    cwdUtf8Bytes: bytes(cwd),
    cwdInherited: input.cwd === undefined,
    largestArgs: entries
      .sort(
        (a, b) =>
          (process.platform === 'win32' ? b.utf16Units - a.utf16Units : b.utf8Bytes - a.utf8Bytes) || a.index - b.index
      )
      .slice(0, 3)
  }
}

/** Fixed text containing only measurements and allowlisted owners. */
export function formatLaunchSizeSummary(size: ClaudeCodeLaunchSize): string {
  const { largestArgs, ...aggregates } = size
  return `${Object.entries(aggregates)
    .map(([key, value]) => `${key}=${value}`)
    .join(
      ' '
    )} largestArgs=${largestArgs.map(({ index, owner, utf16Units, utf8Bytes }) => `${index}:${owner}:${utf16Units}:${utf8Bytes}`).join(',')}`
}
