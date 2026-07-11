import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCliVersionStatuses } from '../useCliVersionStatuses'

const ipcMocks = vi.hoisted(() => ({
  resolveTools: vi.fn(),
  getState: vi.fn(),
  probeSystem: vi.fn(),
  latestVersions: vi.fn()
}))
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input?: unknown) => {
      switch (route) {
        case 'binary.resolve_tools':
          return ipcMocks.resolveTools(input)
        case 'binary.get_latest_versions':
          return ipcMocks.latestVersions(input)
        default:
          throw new Error(`unexpected route: ${route}`)
      }
    }
  },
  useIpcOn: vi.fn((event: string, handler: (payload: unknown) => void) => {
    ipcEventHandlers.set(event, handler)
  })
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

describe('useCliVersionStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    ipcMocks.getState.mockResolvedValue({ tools: {} })
    ipcMocks.probeSystem.mockResolvedValue({})
    ipcMocks.resolveTools.mockImplementation(async (names: string[]) => {
      const [state, system] = await Promise.all([ipcMocks.getState(), ipcMocks.probeSystem(names)])
      return Object.fromEntries(
        names.map((name) => {
          const managed = state.tools[name]
          if (managed) return [name, { source: 'managed', path: `/managed/${name}`, version: managed.version }]
          if (system[name]) return [name, { source: 'system', path: system[name] }]
          return [name, { source: 'none' }]
        })
      )
    })
    ipcMocks.latestVersions.mockResolvedValue({})
  })

  it('uses BinaryManager latest versions to mark installed CLI tools upgradeable', async () => {
    ipcMocks.getState.mockResolvedValue({
      tools: {
        claude: { tool: 'claude', version: '1.0.0' },
        codex: { tool: 'codex', version: '2.0.0' }
      }
    })
    ipcMocks.latestVersions.mockResolvedValue({ claude: '1.1.0', codex: '2.0.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE, CodeCli.OPENAI_CODEX]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({
      installed: true,
      current: '1.0.0',
      latest: '1.1.0',
      canUpgrade: true
    })
    expect(result.current[CodeCli.OPENAI_CODEX]).toMatchObject({
      installed: true,
      current: '2.0.0',
      latest: '2.0.0',
      canUpgrade: false
    })
    expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false)
  })

  it('refreshes latest versions only when the session cache is empty', async () => {
    ipcMocks.getState.mockResolvedValue({ tools: { claude: { tool: 'claude', version: '1.0.0' } } })
    ipcMocks.latestVersions.mockResolvedValueOnce({}).mockResolvedValueOnce({ claude: '1.1.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(1, false)
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(2, true)
  })

  it('treats a system PATH tool as installed without offering managed upgrades', async () => {
    ipcMocks.probeSystem.mockResolvedValue({ claude: '/usr/local/bin/claude' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toEqual({
      installed: true,
      source: 'system',
      systemPath: '/usr/local/bin/claude',
      canUpgrade: false
    })
    expect(ipcMocks.resolveTools).toHaveBeenCalledWith(['claude'])
    expect(ipcMocks.latestVersions).not.toHaveBeenCalled()
  })

  it('does not treat a system OpenClaw as installed because its service requires the managed binary', async () => {
    ipcMocks.probeSystem.mockResolvedValue({ openclaw: '/usr/local/bin/openclaw' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.OPENCLAW]))

    await waitFor(() => expect(result.current[CodeCli.OPENCLAW]).toBeDefined())
    expect(result.current[CodeCli.OPENCLAW]).toEqual({ installed: false, source: 'none', canUpgrade: false })
    expect(ipcMocks.resolveTools).toHaveBeenCalledWith(['openclaw'])
  })

  it('does not mark non-semver versions as upgradeable', async () => {
    ipcMocks.getState.mockResolvedValue({
      tools: {
        claude: { tool: 'claude', version: '1.0.0' }
      }
    })
    ipcMocks.latestVersions.mockResolvedValue({ claude: 'nightly' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({
      latest: 'nightly',
      canUpgrade: false
    })
  })

  it('preserves other tools latest-version hints after one tool changes', async () => {
    ipcMocks.getState.mockResolvedValue({
      tools: {
        claude: { tool: 'claude', version: '1.0.0' },
        codex: { tool: 'codex', version: '2.0.0' }
      }
    })
    ipcMocks.latestVersions.mockResolvedValue({ claude: '1.1.0', codex: '2.1.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE, CodeCli.OPENAI_CODEX]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(result.current[CodeCli.OPENAI_CODEX]?.canUpgrade).toBe(true)

    ipcMocks.getState.mockResolvedValue({
      tools: {
        claude: { tool: 'claude', version: '1.1.0' },
        codex: { tool: 'codex', version: '2.0.0' }
      }
    })
    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.current).toBe('1.1.0'))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({
      installed: true,
      current: '1.1.0',
      latest: '1.1.0',
      canUpgrade: false
    })
    expect(result.current[CodeCli.OPENAI_CODEX]).toMatchObject({
      installed: true,
      current: '2.0.0',
      latest: '2.1.0',
      canUpgrade: true
    })
  })
})
