import { beforeEach, describe, expect, it, vi } from 'vitest'

const shellEnvMock = vi.hoisted(() => ({
  getRawShellEnv: vi.fn<() => Promise<Record<string, string>>>()
}))
const launchMock = vi.hoisted(() => ({
  resolveLaunchCommand: vi.fn(),
  buildStdioEnvironment: vi.fn((login: Record<string, string>, server: Record<string, string>) => ({
    ...login,
    ...server
  }))
}))

vi.mock('@main/utils/shellEnv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/utils/shellEnv')>()
  return { ...actual, getRawShellEnv: shellEnvMock.getRawShellEnv }
})
vi.mock('../mcpLaunch', () => launchMock)
vi.mock('@application', () => ({
  application: {
    get: vi.fn(),
    getPath: (key: string) => (key === 'feature.binary.data' ? '/mock/feature.binary.data' : `/mock/${key}`)
  }
}))

const { getBinaryShimsDir } = await import('@main/utils/binaryEnv')
const { resolveStdioLaunch } = await import('../mcpStdioLaunch')

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never

describe('resolveStdioLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    launchMock.resolveLaunchCommand.mockResolvedValue({
      command: '/usr/bin/uvx',
      args: [],
      env: {},
      resolution: 'system'
    })
  })

  it('strips inherited Cherry shims from PATH when the user owns mise', async () => {
    const shims = getBinaryShimsDir()
    shellEnvMock.getRawShellEnv.mockResolvedValue({
      PATH: `${shims}:/home/user/.local/share/mise/shims:/usr/bin`,
      MISE_DATA_DIR: '/home/user/.local/share/mise'
    })

    await resolveStdioLaunch({
      server: { command: 'uvx', env: {} } as never,
      args: ['pkg'],
      logger
    })

    const spawnEnv = launchMock.resolveLaunchCommand.mock.calls[0][0].loginShellEnv as Record<string, string>
    const segments = spawnEnv.PATH.split(':')
    expect(segments).not.toContain(shims)
    expect(segments).toEqual(['/home/user/.local/share/mise/shims', '/usr/bin', '/mock/cherry.bin'])
    expect(launchMock.resolveLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ useStandaloneBundledBinary: true })
    )
  })
})
