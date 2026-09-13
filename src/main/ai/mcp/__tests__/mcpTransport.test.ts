import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ShellEnvModule from '@main/utils/shellEnv'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'

const inMemoryServerMock = vi.hoisted(() => ({ connect: vi.fn().mockResolvedValue(undefined) }))
const createInMemoryMcpServer = vi.hoisted(() => vi.fn().mockResolvedValue(inMemoryServerMock))
const getBuiltinHttpHeaders = vi.hoisted(() => vi.fn<() => Record<string, string>>(() => ({})))
const hasInMemoryImplementation = vi.hoisted(() => vi.fn<(name: string) => boolean>(() => true))
vi.mock('@main/ai/mcp/servers/factory', () => ({
  createInMemoryMcpServer,
  getBuiltinRegistryEnv: () => ({}),
  getBuiltinHttpHeaders,
  hasInMemoryImplementation
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({})
})
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: vi.fn(() => ''), getPath: vi.fn(() => '/mock') },
  net: { fetch: vi.fn() }
}))
const rawShellEnvMock = vi.hoisted(() => ({ value: { PATH: '/shell/bin' } as Record<string, string> }))
vi.mock('@main/utils/shellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellEnvModule>()),
  getShellEnv: async () => ({ PATH: '/shell/bin' }),
  getRawShellEnv: async () => ({ ...rawShellEnvMock.value })
}))
vi.mock('@main/utils/commandResolver', () => ({
  findExecutableInEnv: async () => '/usr/local/bin/npx',
  findCommandInShellEnv: async () => null
}))
vi.mock('@main/utils/binaryResolver', () => ({
  isBinaryExists: async () => false,
  getBinaryPath: async (name?: string) => `/bundled/${name}`
}))

const { createTransport } = await import('../mcpTransport')

class FakeTransport {
  constructor(
    public url: unknown,
    public options: any
  ) {}
}
class FakeStdioTransport {
  stderr = { on: vi.fn() }
  onerror?: (error: Error) => void
  constructor(public params: any) {}
}
const sdk = {
  SSEClientTransport: FakeTransport,
  StreamableHTTPClientTransport: FakeTransport,
  StdioClientTransport: FakeStdioTransport,
  InMemoryTransport: { createLinkedPair: () => ['client-transport', 'server-transport'] }
} as any

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any
const authProvider = { config: {} } as any

const create = (config: Partial<McpServer>, extra: Partial<Parameters<typeof createTransport>[0]> = {}) =>
  createTransport({
    sdk,
    server: { id: 'id', name: 'srv', isActive: true, ...config },
    args: [],
    authProvider,
    logger,
    onServerLog: () => undefined,
    ...extra
  })

describe('createTransport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts an in-process server and hands back its side of the pipe', async () => {
    const transport = await create({ type: 'inMemory', name: '@cherry/memory', env: { MEMORY_FILE_PATH: '/tmp/m' } })

    expect(createInMemoryMcpServer).toHaveBeenCalledWith('@cherry/memory', [], { MEMORY_FILE_PATH: '/tmp/m' })
    expect(inMemoryServerMock.connect).toHaveBeenCalledWith('server-transport')
    expect(transport).toBe('client-transport')
  })

  it('reports a failed in-process start instead of returning a dead transport', async () => {
    inMemoryServerMock.connect.mockRejectedValueOnce(new Error('boom'))

    await expect(create({ type: 'inMemory', name: '@cherry/memory' })).rejects.toThrow(
      /Failed to start in-memory server: boom/
    )
  })

  it('sends the app headers plus the server’s own on both URL transports', async () => {
    const config = { type: 'streamableHttp' as const, baseUrl: 'https://mcp.example/mcp', headers: { APP: 'x' } }

    const http = (await create(config)) as unknown as FakeTransport
    expect(http.options.requestInit.headers).toMatchObject({ 'X-Title': 'Cherry Studio', APP: 'x' })
    expect(http.options.fetch).toBeTypeOf('function')

    const sse = (await create({ ...config, type: 'sse' })) as unknown as FakeTransport
    expect(sse.options.requestInit.headers).toMatchObject({ 'X-Title': 'Cherry Studio', APP: 'x' })
    expect(sse.options.eventSourceInit.fetch).toBeTypeOf('function')
  })

  it('skips the OAuth provider when the server carries its own Authorization header', async () => {
    for (const name of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      const withKey = (await create({
        type: 'streamableHttp',
        baseUrl: 'https://mcp.example/mcp',
        headers: { [name]: 'Bearer key' }
      })) as unknown as FakeTransport
      expect(withKey.options.authProvider, name).toBeUndefined()
    }

    const withoutKey = (await create({
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp'
    })) as unknown as FakeTransport
    expect(withoutKey.options.authProvider).toBe(authProvider)
  })

  it('sends one value per header name, whatever casing each source used', async () => {
    getBuiltinHttpHeaders.mockReturnValueOnce({ Authorization: 'Bearer builtin' })
    const transport = (await create({
      type: 'streamableHttp',
      baseUrl: 'https://mcp.example/mcp',
      headers: { authorization: 'Bearer user', 'x-title': 'mine' }
    })) as unknown as FakeTransport

    const headers: Record<string, string> = transport.options.requestInit.headers
    const names = Object.keys(headers)
    expect(names.filter((name) => name.toLowerCase() === 'authorization')).toHaveLength(1)
    expect(names.filter((name) => name.toLowerCase() === 'x-title')).toHaveLength(1)
    // Later source wins: builtin credential over the user's, the user's title over the app default.
    expect(Object.values(headers)).toContain('Bearer builtin')
    expect(Object.values(headers)).toContain('mine')
  })

  it('honours the transport override so a fallback attempt uses the other transport', async () => {
    const transport = (await create(
      { type: 'sse', baseUrl: 'https://mcp.example/mcp' },
      { typeOverride: 'streamableHttp' }
    )) as unknown as FakeTransport

    // The streamableHttp shape is the tell: its fetch sits at the top level, sse's does not.
    expect(transport.options.fetch).toBeTypeOf('function')
    expect(transport.options.eventSourceInit).toBeUndefined()
  })

  it('launches a stdio server with the resolved command and a proxy-free shell env', async () => {
    const transport = (await create({
      type: 'stdio',
      command: 'npx',
      registryUrl: 'https://registry.example'
    })) as unknown as FakeStdioTransport

    expect(transport.params.command).toBe('/usr/local/bin/npx')
    expect(transport.params.env.NPM_CONFIG_REGISTRY).toBe('https://registry.example')
    const pathValue = transport.params.env.PATH as string
    // Full fallback order: user entries first, then Cherry's shims, bundled
    // binaries, and git tail — nothing else, in layout order.
    const normalizedPath = pathValue.replace(/\\/g, '/')
    expect(normalizedPath.split(/[:;]/)).toEqual(['/shell/bin', '/mock/feature.binary.data/shims', '/mock/cherry.bin'])
    // With no user mise, Cherry's execution env keeps its shims resolvable.
    expect(transport.params.env.MISE_DATA_DIR).toBe('/mock/feature.binary.data')
    expect(transport.params.stderr).toBe('pipe')
  })

  it.skipIf(process.platform === 'win32')(
    'ignores a lowercase `path` variable when building the stdio PATH',
    async () => {
      // POSIX env keys are case-sensitive: a stray lowercase `path` must not
      // leak segments into the spawned server's PATH, and stays untouched.
      rawShellEnvMock.value = { PATH: '/shell/bin', path: '/stray/evil' }
      try {
        const transport = (await create({
          type: 'stdio',
          command: 'npx',
          registryUrl: 'https://registry.example'
        })) as unknown as FakeStdioTransport

        const pathValue = transport.params.env.PATH as string
        expect(pathValue.split(':')).not.toContain('/stray/evil')
        expect(pathValue.split(':')[0]).toBe('/shell/bin')
        expect(transport.params.env.path).toBe('/stray/evil')
      } finally {
        rawShellEnvMock.value = { PATH: '/shell/bin' }
      }
    }
  )

  it('forwards stdio stderr to the server log, skipping empty chunks', async () => {
    const entries: McpServerLogEntry[] = []
    const transport = (await create(
      { type: 'stdio', command: 'npx' },
      { onServerLog: (entry) => entries.push(entry) }
    )) as unknown as FakeStdioTransport

    const onData = transport.stderr.on.mock.calls.find(([event]) => event === 'data')?.[1]
    onData(Buffer.from('server crashed\n'))
    onData(Buffer.from('   '))

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ level: 'stderr', message: 'server crashed', source: 'stdio' })
  })

  it('forwards the underlying spawn error details to app and server logs', async () => {
    const entries: McpServerLogEntry[] = []
    const transport = (await create(
      { type: 'stdio', command: 'C:\\missing\\uvx.exe' },
      { onServerLog: (entry) => entries.push(entry) }
    )) as unknown as FakeStdioTransport
    const error = Object.assign(new Error('spawn C:\\missing\\uvx.exe ENOENT'), {
      code: 'ENOENT',
      errno: -4058,
      syscall: 'spawn C:\\missing\\uvx.exe',
      path: 'C:\\missing\\uvx.exe'
    })

    transport.onerror?.(error)

    expect(logger.error).toHaveBeenCalledWith('Stdio transport error', error, {
      code: 'ENOENT',
      errno: -4058,
      syscall: 'spawn C:\\missing\\uvx.exe',
      path: 'C:\\missing\\uvx.exe'
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'error',
      message: expect.stringContaining('code=ENOENT'),
      data: expect.objectContaining({ code: 'ENOENT', path: 'C:\\missing\\uvx.exe' }),
      source: 'stdio'
    })
  })

  it('runs an in-memory row we cannot start in-process through the connection it declares', async () => {
    // Legacy rows kept `inMemory` alongside a command; before, they connected via that command.
    hasInMemoryImplementation.mockReturnValueOnce(false)

    const transport = (await create({
      type: 'inMemory',
      name: '@cherry/mcp-auto-install',
      command: 'npx'
    })) as unknown as FakeStdioTransport

    expect(transport.params.command).toBe('/usr/local/bin/npx')
    expect(createInMemoryMcpServer).not.toHaveBeenCalled()
  })

  it('names the missing in-process server when the row declares no connection either', async () => {
    hasInMemoryImplementation.mockReturnValueOnce(false)

    await expect(create({ type: 'inMemory', name: '@cherry/ghost' })).rejects.toThrow(
      /Unknown in-memory MCP server: @cherry\/ghost/
    )
  })

  it('refuses a config that says neither where to connect nor what to run', async () => {
    await expect(create({ type: 'stdio' })).rejects.toThrow(/Either baseUrl or command must be provided/)
  })
})
