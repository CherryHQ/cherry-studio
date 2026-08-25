import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('resolveLaunchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    binaryMock.isBinaryExists.mockResolvedValue(false)
    binaryMock.getBinaryPath.mockImplementation(async (name) => `/bundled/${name}`)
    commandMock.findExecutableInEnv.mockResolvedValue(null)
    commandMock.findCommandInShellEnv.mockResolvedValue(null)
  })

  it('prefers the user’s own npx over the bundled runtime', async () => {
    commandMock.findExecutableInEnv.mockResolvedValue('/usr/local/bin/npx')

    const launch = await resolve('npx', ['-y', 'example-mcp'])

    expect(launch).toEqual({ command: '/usr/local/bin/npx', args: ['-y', 'example-mcp'], env: {} })
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

  it('throws an actionable error when neither npx nor bundled bun exists', async () => {
    await expect(resolve('npx', ['example-mcp'])).rejects.toThrow(/npx not found in PATH and bundled bun/)
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
    expect((await resolve('my-server', ['--stdio'])).command).toBe('/opt/tools/my-server')

    const unresolved = await resolve('my-server', ['--stdio'])
    expect(unresolved.command).toBe('my-server')
    expect(logger.warn).toHaveBeenCalled()
  })
})
