import type { LoggerService } from '@logger'
import { getBinaryPath, isBinaryExists } from '@main/utils/binaryResolver'
import { findCommandInShellEnv, findExecutableInEnv } from '@main/utils/commandResolver'

type Runner = {
  /** Bundled binary to fall back on when the command is missing from PATH; defaults to the command. */
  bundled?: string
  transformArgs?: (args: string[]) => string[]
  registryEnv?: (url: string) => Record<string, string>
  notFound: (command: string) => string
}

const uvRunner: Runner = {
  registryEnv: (url) => ({ UV_DEFAULT_INDEX: url, PIP_INDEX_URL: url }),
  notFound: (command) =>
    `${command} not found in PATH and bundled version is not available. This may indicate an installation issue.\n` +
    'Please either:\n' +
    '1. Install uv from https://github.com/astral-sh/uv\n' +
    '2. Run the MCP dependencies installer from Settings\n' +
    `3. Restart the application if you recently installed ${command}`
}

const RUNNERS: Record<string, Runner> = {
  npx: {
    bundled: 'bun',
    // `bun x -y <pkg>` is bun's npx equivalent. Prefix by position, not membership: a package
    // argument that happens to be `x` or `-y` must not suppress it.
    transformArgs: (args) => (args.length === 0 ? args : args[0] === '-y' ? ['x', ...args] : ['x', '-y', ...args]),
    registryEnv: (url) => ({ NPM_CONFIG_REGISTRY: url }),
    notFound: () =>
      'npx not found in PATH and bundled bun is not available. This may indicate an installation issue.\n' +
      'Please either:\n' +
      '1. Install Node.js (which includes npx) from https://nodejs.org\n' +
      '2. Run the MCP dependencies installer from Settings\n' +
      '3. Restart the application if you recently installed Node.js'
  },
  uvx: uvRunner,
  uv: uvRunner
}

export type LaunchCommand = {
  command: string
  args: string[]
  /** Registry env the resolved package manager reads; merge into the transport env. */
  env: Record<string, string>
  resolution: 'system' | 'bundled' | 'unresolved'
  unavailableReason?: string
}

type CommandResolution = Pick<LaunchCommand, 'command' | 'resolution' | 'unavailableReason'>
export type LaunchResolutionCache = Map<string, Promise<CommandResolution>>

/**
 * Resolves what a stdio server is actually started with: the user's own `npx` / `uvx` / `uv`
 * when it is in PATH, otherwise the bundled binary. Any other command is best-effort resolved
 * to a full path so cross-spawn does not depend on a possibly incomplete PATH.
 */
export async function resolveLaunchCommand({
  command,
  args,
  registryUrl,
  loginShellEnv,
  logger,
  signal,
  resolutionCache
}: {
  command: string
  args: string[]
  registryUrl?: string
  loginShellEnv: Record<string, string>
  logger: LoggerService
  signal?: AbortSignal
  resolutionCache?: LaunchResolutionCache
}): Promise<LaunchCommand> {
  const normalizedCommand = command.trim()
  signal?.throwIfAborted()
  if (!normalizedCommand) {
    throw new Error('MCP stdio command cannot be empty')
  }

  const runner = RUNNERS[normalizedCommand]
  const env = runner?.registryEnv && registryUrl ? runner.registryEnv(registryUrl) : {}

  const resolve = async (): Promise<CommandResolution> => {
    const systemPath = runner
      ? await findExecutableInEnv(normalizedCommand, { env: loginShellEnv, signal })
      : await findCommandInShellEnv(normalizedCommand, loginShellEnv, signal)
    signal?.throwIfAborted()
    if (systemPath) return { command: systemPath, resolution: 'system' }
    if (!runner) return { command: normalizedCommand, resolution: 'unresolved' }
    const bundled = runner.bundled ?? normalizedCommand
    if (!(await isBinaryExists(bundled))) {
      return {
        command: normalizedCommand,
        resolution: 'unresolved',
        unavailableReason: runner.notFound(normalizedCommand)
      }
    }
    const command = await getBinaryPath(bundled)
    signal?.throwIfAborted()
    return { command, resolution: 'bundled' }
  }
  const key = JSON.stringify([normalizedCommand, Object.entries(loginShellEnv).sort(([a], [b]) => a.localeCompare(b))])
  let pending = resolutionCache?.get(key)
  if (!pending) {
    pending = resolve()
    resolutionCache?.set(key, pending)
  }
  const resolution = await pending
  signal?.throwIfAborted()
  logger.debug('Resolved stdio launch command', { resolution: resolution.resolution })
  return {
    ...resolution,
    args: resolution.resolution === 'bundled' ? (runner?.transformArgs?.(args) ?? args) : args,
    env
  }
}

export function buildStdioEnvironment(
  loginShellEnv: Record<string, string>,
  serverEnv: Record<string, string>
): Record<string, string> {
  const env = { ...loginShellEnv, ...serverEnv }
  if (process.platform !== 'win32') return env

  const serverPathKey = Object.keys(serverEnv)
    .filter((key) => key.toLowerCase() === 'path')
    .at(-1)
  const shellPathKey = Object.keys(loginShellEnv)
    .filter((key) => key.toLowerCase() === 'path')
    .at(-1)
  const pathValue = serverPathKey ? serverEnv[serverPathKey] : shellPathKey ? loginShellEnv[shellPathKey] : undefined

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key]
  }
  if (pathValue !== undefined) env.PATH = pathValue

  return env
}
