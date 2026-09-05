import { application } from '@application'
import type { McpServer } from '@shared/data/types/mcpServer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mcpServers = vi.hoisted(() => ({ list: vi.fn(), getById: vi.fn() }))
const runtime = vi.hoisted(() => ({ isReady: true, restartServer: vi.fn() }))
const cache = vi.hoisted(() => ({ getShared: vi.fn() }))
const launch = vi.hoisted(() => ({ resolveStdioLaunch: vi.fn() }))

vi.mock('@data/services/McpServerService', () => ({ mcpServerService: mcpServers }))
vi.mock('@main/ai/mcp/mcpStdioLaunch', () => launch)
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

const { mcpLaunchCommands, mcpServersConnected } = await import('../mcp')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

function server(id: string, overrides: Partial<McpServer> = {}): McpServer {
  return { id, name: id, type: 'stdio', command: 'npx', isActive: true, ...overrides } as McpServer
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'CacheService') return cache
    if (name === 'McpRuntimeService') return runtime
    throw new Error(`Unexpected application.get(${name})`)
  }) as typeof application.get)
  mcpServers.list.mockReturnValue({ items: [], total: 0, page: 1 })
  launch.resolveStdioLaunch.mockResolvedValue({ launch: { command: '/bin/npx', args: [], env: {} } })
})

describe('mcp-servers-connected', () => {
  it('does not pass when an enabled server has no runtime status', async () => {
    mcpServers.list.mockReturnValue({ items: [server('starting')] })
    cache.getShared.mockReturnValue(undefined)
    await expect(mcpServersConnected.run(ctx)).rejects.toThrow('settled')
  })
  it('warns for each enabled server in the error state and offers a targeted restart', async () => {
    const working = server('working')
    const brokenA = server('broken-a')
    const brokenB = server('broken-b')
    mcpServers.list.mockReturnValue({ items: [working, brokenA, brokenB], total: 3, page: 1 })
    cache.getShared.mockImplementation(
      (key: string) =>
        ({
          'mcp.status.working': { state: 'connected', lastCheckedAt: 1 },
          'mcp.status.broken-a': { state: 'error', lastCheckedAt: 1, lastError: 'secret A' },
          'mcp.status.broken-b': { state: 'error', lastCheckedAt: 1, lastError: 'secret B' }
        })[key]
    )

    const result = await mcpServersConnected.run(ctx)

    expect(result).toMatchObject({
      status: 'warn',
      detail: { variant: 'server_errors', params: { count: 2 } },
      actions: [
        { kind: 'fix', fixId: 'restart', target: 'broken-a' },
        { kind: 'fix', fixId: 'restart', target: 'broken-b' }
      ]
    })
    expect(
      result.evidence
        ?.filter((item) => item.dataClass !== 'consent_required')
        .map((item) => item.value)
        .join()
    ).not.toContain('secret A')
    expect(result.evidence).toContainEqual({
      key: 'lastErrors',
      value: 'secret A\nsecret B',
      dataClass: 'consent_required'
    })
  })

  it('restarts only the targeted active server', async () => {
    mcpServers.getById.mockReturnValue(server('broken'))

    await expect(mcpServersConnected.fixes.restart({ ...ctx, target: 'broken' })).resolves.toEqual({ status: 'fixed' })
    expect(runtime.restartServer).toHaveBeenCalledWith('broken')
  })
})

describe('mcp-launch-commands', () => {
  it('keeps failed lookup evidence separate from command-not-found findings', async () => {
    mcpServers.list.mockReturnValue({ items: [server('broken')] })
    launch.resolveStdioLaunch.mockRejectedValue(new Error('/private/tool: query failed'))
    const result = await mcpLaunchCommands.run(ctx)
    expect(result).toMatchObject({ status: 'warn', detail: { variant: 'query_failed' } })
    expect(result.evidence).toContainEqual({
      key: 'queryError',
      value: JSON.stringify({ serverId: 'broken', message: '/private/tool: query failed' }),
      dataClass: 'consent_required'
    })
  })

  it('propagates cancellation rather than recording a missing command', async () => {
    const controller = new AbortController()
    mcpServers.list.mockReturnValue({ items: [server('first'), server('second')] })
    launch.resolveStdioLaunch.mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    await expect(mcpLaunchCommands.run({ ...ctx, signal: controller.signal })).rejects.toThrow()
    expect(launch.resolveStdioLaunch).toHaveBeenCalledTimes(1)
  })
  it('fails when an enabled stdio command cannot be resolved and ignores remote servers', async () => {
    const good = server('good')
    const broken = server('broken', { command: 'missing' })
    const remote = server('remote', { type: 'streamableHttp', command: undefined, baseUrl: 'https://mcp.example' })
    mcpServers.list.mockReturnValue({ items: [good, broken, remote], total: 3, page: 1 })
    launch.resolveStdioLaunch.mockImplementation(({ server: candidate }: { server: McpServer }) =>
      Promise.resolve({ launch: { resolution: candidate.id === 'broken' ? 'unresolved' : 'system' } })
    )

    const result = await mcpLaunchCommands.run(ctx)

    expect(result).toMatchObject({
      status: 'fail',
      detail: { variant: 'unresolved', params: { count: 1 } },
      actions: [{ kind: 'navigate', target: '/settings/mcp' }]
    })
    expect(JSON.stringify(result)).not.toContain('/private/path')
    expect(launch.resolveStdioLaunch).toHaveBeenCalledTimes(2)
    expect(launch.resolveStdioLaunch).toHaveBeenCalledWith(expect.objectContaining({ signal }))
  })

  it('passes when every enabled stdio command resolves', async () => {
    mcpServers.list.mockReturnValue({ items: [server('good')], total: 1, page: 1 })

    await expect(mcpLaunchCommands.run(ctx)).resolves.toEqual({ status: 'pass' })
  })
})
