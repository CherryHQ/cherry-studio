import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getShellEnv: vi.fn(async () => ({ Path: 'C:\\Users\\User\\scoop\\shims;C:\\Windows\\system32' })),
  refreshShellEnv: vi.fn(async () => ({ Path: 'C:\\Users\\User\\scoop\\shims;C:\\Windows\\system32' })),
  getBinaryPath: vi.fn(async () => 'C:\\Cherry\\bun.exe'),
  getProxyEnvironment: vi.fn(() => ({})),
  resolveWindowsAgentShell: vi.fn(),
  getByKey: vi.fn(() => {
    throw new Error('missing')
  }),
  getPath: vi.fn((key: string) => `/mock/${key}`)
}))

vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false
}))

vi.mock('@application', () => ({
  application: {
    getPath: mocks.getPath
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.getByKey }
}))

vi.mock('@main/services/proxy/proxyEnv', () => ({
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: (p: string) => p
}))

vi.mock('@main/utils/binaryResolver', () => ({
  getBinaryPath: mocks.getBinaryPath
}))

vi.mock('@main/utils/commandResolver', () => ({
  resolveWindowsAgentShell: mocks.resolveWindowsAgentShell
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: mocks.getShellEnv,
  refreshShellEnv: mocks.refreshShellEnv
}))

vi.mock('../agentProxyEnvironment', () => ({
  hasStaleCherryProxyMarkers: () => false,
  mergeAgentLoopbackProxyBypass: (env: Record<string, string | undefined>) => env,
  stripInheritedCherryProxyMarkers: (env: Record<string, string | undefined>) => env
}))

const { buildEnvironment } = await import('../environment')

describe('buildEnvironment Windows shell wiring', () => {
  const agent = {
    id: 'agent-1',
    model: 'openai::gpt-4.1',
    configuration: {}
  } as never

  const provider = { id: 'openai' } as never

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getShellEnv.mockResolvedValue({ Path: 'C:\\Users\\User\\scoop\\shims;C:\\Windows\\system32' })
    mocks.getBinaryPath.mockResolvedValue('C:\\Cherry\\bun.exe')
    mocks.getProxyEnvironment.mockReturnValue({})
  })

  it('pins CLAUDE_CODE_GIT_BASH_PATH when login-PATH discovery finds Git Bash', async () => {
    // Bug this catches: discovery used process.env instead of login PATH, so Scoop Git was
    // missed and the session started with no shell tool / no actionable failure.
    mocks.resolveWindowsAgentShell.mockReturnValue({
      kind: 'git-bash',
      path: 'C:\\Users\\User\\scoop\\apps\\git\\current\\bin\\bash.exe'
    })

    const env = await buildEnvironment(provider, agent)

    expect(mocks.resolveWindowsAgentShell).toHaveBeenCalledWith(
      expect.objectContaining({ Path: expect.stringContaining('scoop') })
    )
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe('C:\\Users\\User\\scoop\\apps\\git\\current\\bin\\bash.exe')
    expect(env.CLAUDE_CODE_USE_POWERSHELL_TOOL).toBeUndefined()
  })

  it('enables PowerShell tool mode when Git Bash is absent', async () => {
    mocks.resolveWindowsAgentShell.mockReturnValue({
      kind: 'powershell',
      path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    })

    const env = await buildEnvironment(provider, agent)

    expect(env.CLAUDE_CODE_USE_POWERSHELL_TOOL).toBe('1')
    expect(env.POWERSHELL_TELEMETRY_OPTOUT).toBe('1')
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBeUndefined()
  })

  it('fails with an actionable error when no Windows shell can be resolved', async () => {
    mocks.resolveWindowsAgentShell.mockReturnValue({
      kind: 'unavailable',
      reason:
        'No Windows shell is available for Agent tools. Install Git for Windows (or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe), or ensure Windows PowerShell is installed.'
    })

    await expect(buildEnvironment(provider, agent)).rejects.toThrow(/No Windows shell is available/i)
  })
})
