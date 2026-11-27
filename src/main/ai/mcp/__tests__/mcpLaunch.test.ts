import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LaunchResolutionCache } from '../mcpLaunch'

const binaryMock = vi.hoisted(() => ({
  isBinaryExists: vi.fn<(name: string) => Promise<boolean>>(),
  getBinaryPath: vi.fn<(name?: string) => Promise<string>>()
}))
const commandMock = vi.hoisted(() => ({
  findExecutableInEnv: vi.fn<(name: string) => Promise<string | null>>(),
  findCommandInShellEnv: vi.fn<(name: string, env: Record<string, string>) => Promise<string | null>>()
}))

vi.mock('@main/utils/binaryResolver', () => binaryMock)
vi.mock('@main/utils/commandResolver', () => commandMock)

const { resolveLaunchCommand } = await import('../mcpLaunch')

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any

const resolve = (command: string, args: string[] = [], registryUrl?: string) =>
  resolveLaunchCommand({ command, args, registryUrl, loginShellEnv: { PATH: '/usr/bin' }, logger })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('resolveLaunchCommand', () => {
  it('shares resolution by command and effective environment without sharing arguments or registries', async () => {
    commandMock.findExecutableInEnv.mockResolvedValue(null)
    binaryMock.isBinaryExists.mockResolvedValue(true)
    const resolutionCache = new Map()
    const options = { command: 'npx', loginShellEnv: { PATH: '/a' }, logger, resolutionCache }
    const a = await resolveLaunchCommand({ ...options, args: ['one'], registryUrl: 'https://one.example' })
    const b = await resolveLaunchCommand({ ...options, args: ['two'], registryUrl: 'https://two.example' })
    expect(a.args).toEqual(['x', '-y', 'one'])
    expect(b.args).toEqual(['x', '-y', 'two'])
    expect(b.env).toEqual({ NPM_CONFIG_REGISTRY: 'https://two.example' })
    expect(commandMock.findExecutableInEnv).toHaveBeenCalledTimes(1)
    await resolveLaunchCommand({ ...options, loginShellEnv: { PATH: '/b' }, args: [] })
    expect(commandMock.findExecutableInEnv).toHaveBeenCalledTimes(2)
  })
  beforeEach(() => {
    vi.clearAllMocks()
    binaryMock.isBinaryExists.mockResolvedValue(false)
    binaryMock.getBinaryPath.mockImplementation(async (name) => `/bundled/${name}`)
    commandMock.findExecutableInEnv.mockResolvedValue(null)
    commandMock.findCommandInShellEnv.mockResolvedValue(null)
  })

  it.each([
    [
      'EACCES',
      Object.assign(new Error('Access denied'), {
        code: 'EACCES',
        errno: -4092,
        syscall: 'stat',
        path: 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\PackageFamilyName\\server.exe'
      })
    ],
    ['timeout', new Error('Timed out resolving command')]
  ])('attempts the configured non-runner command after a lookup %s error', async (_name, error) => {
    const command = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\PackageFamilyName\\server.exe'
    const args = ['--stdio', 'example']
    commandMock.findCommandInShellEnv.mockRejectedValueOnce(error)

    const launch = await resolve(`  ${command}  `, args)

    expect(launch).toEqual({ command, args, env: {}, resolution: 'unresolved', lookupError: error })
    expect(launch.lookupError).toBe(error)
    expect(launch.args).toBe(args)
    expect(launch).not.toHaveProperty('unavailableReason')
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to resolve stdio command; attempting the configured command',
      { command, error }
    )
    expect(logger.warn.mock.calls[0][1].error).toBe(error)
  })

  it.each([undefined, null, ''])('preserves a falsy lookup rejection (%s) on the fallback launch', async (error) => {
    const args = ['--stdio']
    commandMock.findCommandInShellEnv.mockRejectedValueOnce(error)

    const launch = await resolve('  my-server  ', args)

    expect(launch).toEqual({ command: 'my-server', args, env: {}, resolution: 'unresolved', lookupError: error })
    expect(launch).toHaveProperty('lookupError')
    expect(launch.lookupError).toBe(error)
    expect(launch.args).toBe(args)
    expect(launch).not.toHaveProperty('unavailableReason')
  })

  it('evicts a failed lookup and caches its successful retry without deleting unrelated entries', async () => {
    const resolutionCache: LaunchResolutionCache = new Map()
    const options = { loginShellEnv: { PATH: '/usr/bin' }, args: [], logger, resolutionCache }
    commandMock.findCommandInShellEnv.mockResolvedValueOnce('/opt/tools/healthy')
    await resolveLaunchCommand({ ...options, command: 'healthy' })
    const [healthyKey, healthyPending] = [...resolutionCache.entries()][0]
    const lookup = deferred<string | null>()
    commandMock.findCommandInShellEnv.mockReturnValueOnce(lookup.promise)
    const failed = resolveLaunchCommand({ ...options, command: 'my-server' })
    const failedKey = [...resolutionCache.keys()].find((key) => key !== healthyKey)!
    const error = new Error('Lookup failed')
    lookup.reject(error)

    expect(await failed).toEqual({
      command: 'my-server',
      args: [],
      env: {},
      resolution: 'unresolved',
      lookupError: error
    })
    expect(resolutionCache.has(failedKey)).toBe(false)
    expect(resolutionCache.get(healthyKey)).toBe(healthyPending)
    commandMock.findCommandInShellEnv.mockResolvedValueOnce('/opt/tools/my-server')
    const successful = await resolveLaunchCommand({ ...options, command: 'my-server' })
    expect(successful).toEqual({ command: '/opt/tools/my-server', args: [], env: {}, resolution: 'system' })
    expect(successful).not.toHaveProperty('lookupError')
    const successfulPending = resolutionCache.get(failedKey)
    expect(successfulPending).toBeDefined()
    commandMock.findCommandInShellEnv.mockRejectedValue(new Error('Must reuse the cached success'))
    expect(await resolveLaunchCommand({ ...options, command: 'my-server' })).toEqual(successful)
    expect(resolutionCache.get(failedKey)).toBe(successfulPending)
    expect(await resolveLaunchCommand({ ...options, command: 'healthy' })).toEqual({
      command: '/opt/tools/healthy',
      args: [],
      env: {},
      resolution: 'system'
    })
    expect(resolutionCache.get(healthyKey)).toBe(healthyPending)
  })

  it('preserves a replacement cache promise when two waiters recover from the old rejection', async () => {
    const resolutionCache: LaunchResolutionCache = new Map()
    const options = { command: 'my-server', loginShellEnv: {}, args: [], logger, resolutionCache }
    const lookup = deferred<string | null>()
    commandMock.findCommandInShellEnv.mockReturnValueOnce(lookup.promise)
    const first = resolveLaunchCommand(options)
    const second = resolveLaunchCommand(options)
    const [key, pending] = [...resolutionCache.entries()][0]
    const replacement = deferred<Awaited<typeof pending>>()
    resolutionCache.set(key, replacement.promise)
    const error = new Error('Old lookup failed')
    lookup.reject(error)

    expect(await Promise.all([first, second])).toEqual([
      { command: 'my-server', args: [], env: {}, resolution: 'unresolved', lookupError: error },
      { command: 'my-server', args: [], env: {}, resolution: 'unresolved', lookupError: error }
    ])
    expect(resolutionCache.get(key)).toBe(replacement.promise)
    const next = resolveLaunchCommand(options)
    replacement.resolve({ command: '/opt/tools/my-server', resolution: 'system' })
    expect(await next).toEqual({ command: '/opt/tools/my-server', args: [], env: {}, resolution: 'system' })
    expect(resolutionCache.get(key)).toBe(replacement.promise)
    expect(commandMock.findCommandInShellEnv).toHaveBeenCalledTimes(1)
  })

  it.each(['npx', 'uvx', 'uv'])('propagates %s lookup errors without trying a bundled binary', async (command) => {
    const error = new Error('Runner lookup failed')
    commandMock.findExecutableInEnv.mockRejectedValueOnce(error)
    binaryMock.isBinaryExists.mockResolvedValue(true)

    await expect(resolve(command)).rejects.toBe(error)
    expect(binaryMock.isBinaryExists).not.toHaveBeenCalled()
    expect(binaryMock.getBinaryPath).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('rejects a pre-aborted call without looking up or recovering the command', async () => {
    const controller = new AbortController()
    const error = new Error('Cancelled')
    controller.abort(error)

    await expect(
      resolveLaunchCommand({
        command: 'my-server',
        args: [],
        loginShellEnv: {},
        logger,
        signal: controller.signal
      })
    ).rejects.toBe(error)
    expect(commandMock.findCommandInShellEnv).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'rejects cancellation during a deferred lookup that will %s',
    async (outcome) => {
      const controller = new AbortController()
      const error = new Error('Cancelled')
      const lookup = deferred<string | null>()
      commandMock.findCommandInShellEnv.mockReturnValueOnce(lookup.promise)
      const launch = resolveLaunchCommand({
        command: 'my-server',
        args: [],
        loginShellEnv: {},
        logger,
        signal: controller.signal
      })
      const assertion = expect(launch).rejects.toBe(error)
      controller.abort(error)
      if (outcome === 'resolve') lookup.resolve('/opt/tools/my-server')
      else lookup.reject(error)

      await assertion
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it.each(['resolve', 'reject'] as const)(
    'rejects cancellation while awaiting a cached result that will %s',
    async (outcome) => {
      const resolutionCache: LaunchResolutionCache = new Map()
      const options = { command: 'my-server', args: [], loginShellEnv: {}, logger, resolutionCache }
      await resolveLaunchCommand(options)
      const [key] = resolutionCache.keys()
      const cached = deferred<{ command: string; resolution: 'system' }>()
      resolutionCache.set(key, cached.promise)
      const controller = new AbortController()
      const error = new Error('Cancelled')
      const launch = resolveLaunchCommand({ ...options, signal: controller.signal })
      const assertion = expect(launch).rejects.toBe(error)
      controller.abort(error)
      if (outcome === 'resolve') cached.resolve({ command: '/opt/tools/my-server', resolution: 'system' })
      else cached.reject(error)

      await assertion
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it('propagates a bundled binary check rejection after a runner system lookup misses', async () => {
    const error = new Error('Bundled binary check failed')
    commandMock.findExecutableInEnv.mockResolvedValueOnce(null)
    binaryMock.isBinaryExists.mockRejectedValueOnce(error)

    await expect(resolve('npx')).rejects.toBe(error)
    expect(binaryMock.getBinaryPath).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('prefers the user’s own npx over the bundled runtime', async () => {
    commandMock.findExecutableInEnv.mockResolvedValue('/usr/local/bin/npx')

    const launch = await resolve('npx', ['-y', 'example-mcp'])

    expect(launch).toMatchObject({
      command: '/usr/local/bin/npx',
      args: ['-y', 'example-mcp'],
      env: {},
      resolution: 'system'
    })
    expect(binaryMock.isBinaryExists).not.toHaveBeenCalled()
  })

  it('falls back to bundled bun and rewrites the args for `bun x`', async () => {
    binaryMock.isBinaryExists.mockResolvedValue(true)

    const launch = await resolve('npx', ['-y', 'example-mcp'])

    expect(launch.command).toBe('/bundled/bun')
    expect(launch.args).toEqual(['x', '-y', 'example-mcp'])
  })

  it('prefixes `x -y` by position, including when the package itself is named x or -y', async () => {
    binaryMock.isBinaryExists.mockResolvedValue(true)

    expect((await resolve('npx', ['x'])).args).toEqual(['x', '-y', 'x'])
    expect((await resolve('npx', ['-y'])).args).toEqual(['x', '-y'])
    expect((await resolve('npx', ['pkg', 'x'])).args).toEqual(['x', '-y', 'pkg', 'x'])
    expect((await resolve('npx', ['pkg', '-y'])).args).toEqual(['x', '-y', 'pkg', '-y'])
  })

  it('does not mutate the caller’s args', async () => {
    binaryMock.isBinaryExists.mockResolvedValue(true)
    const args = ['-y', 'example-mcp']

    await resolve('npx', args)

    expect(args).toEqual(['-y', 'example-mcp'])
  })

  it('reports unresolved with the production failure reason when neither npx nor bundled bun exists', async () => {
    await expect(resolve('npx', ['example-mcp'])).resolves.toMatchObject({
      resolution: 'unresolved',
      unavailableReason: expect.stringMatching(/npx not found in PATH and bundled bun/)
    })
  })

  it('falls back to the bundled binary of the same name for uv and uvx', async () => {
    binaryMock.isBinaryExists.mockResolvedValue(true)

    expect((await resolve('uvx', ['example'])).command).toBe('/bundled/uvx')
    expect((await resolve('uv', ['run'])).command).toBe('/bundled/uv')
    // uv takes the package spec as-is; only bun needs the `x` rewrite.
    expect((await resolve('uvx', ['example'])).args).toEqual(['example'])
  })

  it('passes the registry through the env each package manager reads', async () => {
    commandMock.findExecutableInEnv.mockResolvedValue('/usr/local/bin/tool')

    expect((await resolve('npx', [], 'https://registry.example')).env).toEqual({
      NPM_CONFIG_REGISTRY: 'https://registry.example'
    })
    expect((await resolve('uvx', [], 'https://registry.example')).env).toEqual({
      UV_DEFAULT_INDEX: 'https://registry.example',
      PIP_INDEX_URL: 'https://registry.example'
    })
    expect((await resolve('node', [], 'https://registry.example')).env).toEqual({})
  })

  it('resolves an unknown command to a full path, and keeps it verbatim when resolution fails', async () => {
    commandMock.findCommandInShellEnv.mockResolvedValueOnce('/opt/tools/my-server')
    const healthy = await resolve('my-server', ['--stdio'])
    expect(healthy.command).toBe('/opt/tools/my-server')
    expect(healthy).not.toHaveProperty('lookupError')

    const unresolved = await resolve('my-server', ['--stdio'])
    expect(unresolved.command).toBe('my-server')
    expect(unresolved.resolution).toBe('unresolved')
    expect(unresolved).not.toHaveProperty('lookupError')
  })

  it('returns unresolved facts without adding a diagnostic-specific policy', async () => {
    await expect(
      resolveLaunchCommand({
        command: 'missing-server',
        args: [],
        loginShellEnv: { PATH: '/usr/bin' },
        logger
      })
    ).resolves.toMatchObject({ resolution: 'unresolved', command: 'missing-server' })
  })

  it('normalizes surrounding whitespace before resolving or falling back', async () => {
    const launch = await resolve('  my-server  ', ['--stdio'])

    expect(commandMock.findCommandInShellEnv).toHaveBeenCalledWith('my-server', { PATH: '/usr/bin' }, undefined)
    expect(launch.command).toBe('my-server')
  })

  it('rejects a command that is empty after normalization', async () => {
    await expect(resolve('   ')).rejects.toThrow(/MCP stdio command cannot be empty/)
    expect(commandMock.findCommandInShellEnv).not.toHaveBeenCalled()
  })
})
