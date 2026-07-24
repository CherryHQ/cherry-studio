import type { BinaryToolSnapshot } from '@shared/types/binary'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCliVersionStatuses } from '../useCliVersionStatuses'

const snapshotRecords = vi.hoisted(() => ({ value: {} as Record<string, BinaryToolSnapshot> }))
const ipcMocks = vi.hoisted(() => ({ snapshots: vi.fn(), latestVersions: vi.fn() }))
const ipcEventHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

const setSnapshots = (records: Record<string, BinaryToolSnapshot>) => {
  snapshotRecords.value = records
}

const miseSnapshot = (name: string, _tool = name, version = '1.0.0'): BinaryToolSnapshot => ({
  name,
  availability: { source: 'mise', path: `/mise/${name}`, version },
  application: { status: 'applied', version }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input?: unknown) => {
      switch (route) {
        case 'binary.get_tool_snapshots':
          return ipcMocks.snapshots(input)
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
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

describe('useCliVersionStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcEventHandlers.clear()
    setSnapshots({})
    ipcMocks.snapshots.mockImplementation(async (names: string[]) =>
      Object.fromEntries(
        names.flatMap((name) => (snapshotRecords.value[name] ? [[name, snapshotRecords.value[name]]] : []))
      )
    )
    ipcMocks.latestVersions.mockResolvedValue({})
  })

  it('uses BinaryManager latest versions to mark mise CLI tools upgradeable', async () => {
    setSnapshots({
      claude: miseSnapshot('claude', 'claude', '1.0.0'),
      codex: miseSnapshot('codex', 'codex', '2.0.0')
    })
    ipcMocks.latestVersions.mockResolvedValue({ claude: '1.1.0', codex: '2.0.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE, CodeCli.OPENAI_CODEX]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({
      installed: true,
      source: 'mise',
      current: '1.0.0',
      latest: '1.1.0',
      canUpgrade: true
    })
    expect(result.current[CodeCli.OPENAI_CODEX]).toMatchObject({
      installed: true,
      source: 'mise',
      current: '2.0.0',
      latest: '2.0.0',
      canUpgrade: false
    })
    expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false)
  })

  it('refreshes latest versions only when the session cache is empty', async () => {
    setSnapshots({ claude: miseSnapshot('claude') })
    ipcMocks.latestVersions.mockResolvedValueOnce({}).mockResolvedValueOnce({ claude: '1.1.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(1, false)
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(2, true)
  })

  it('treats a system PATH tool as installed without managed upgrades', async () => {
    setSnapshots({ claude: { name: 'claude', availability: { source: 'system', path: '/usr/local/bin/claude' } } })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toEqual({
      installed: true,
      source: 'system',
      systemPath: '/usr/local/bin/claude',
      canUpgrade: false
    })
    expect(ipcMocks.snapshots).toHaveBeenCalledWith(['claude'])
    expect(ipcMocks.latestVersions).not.toHaveBeenCalled()
  })

  it('queries latest for an applied mise CLI', async () => {
    // A fixed CLI carries no definition, so latest authority is the application
    // fact — an applied CLI is still checked for updates.
    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.0.0') })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({
      source: 'mise',
      applicationStatus: 'applied',
      canUpgrade: false
    })
    expect(ipcMocks.latestVersions).toHaveBeenCalledWith(false)
  })

  it('treats a system OpenClaw as installed through the same availability path its service executes', async () => {
    setSnapshots({
      openclaw: { name: 'openclaw', availability: { source: 'system', path: '/usr/local/bin/openclaw' } }
    })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.OPENCLAW]))

    await waitFor(() => expect(result.current[CodeCli.OPENCLAW]?.installed).toBe(true))
    expect(result.current[CodeCli.OPENCLAW]).toEqual({
      installed: true,
      source: 'system',
      systemPath: '/usr/local/bin/openclaw',
      canUpgrade: false
    })
  })

  it('does not mark non-semver versions as upgradeable', async () => {
    setSnapshots({ claude: miseSnapshot('claude') })
    ipcMocks.latestVersions.mockResolvedValue({ claude: 'nightly' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(true))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({ latest: 'nightly', canUpgrade: false })
  })

  it('fetches latest versions when an availability event introduces a newly installed CLI', async () => {
    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))
    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(false))

    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValueOnce({}).mockResolvedValueOnce({ claude: '1.1.0' })
    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(1, false)
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(2, true)
  })

  it('refreshes latest versions after a CLI is removed and reinstalled', async () => {
    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ claude: '1.1.0' })
    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE]))
    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.latest).toBe('1.1.0'))

    setSnapshots({})
    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })
    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.installed).toBe(false))

    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.2.0') })
    ipcMocks.latestVersions.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ claude: '1.3.0' })
    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.latest).toBe('1.3.0'))
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(1, false)
    expect(ipcMocks.latestVersions).toHaveBeenNthCalledWith(2, true)
  })

  it('preserves other tools latest-version hints after one tool changes', async () => {
    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.0.0'), codex: miseSnapshot('codex', 'codex', '2.0.0') })
    ipcMocks.latestVersions.mockResolvedValue({ claude: '1.1.0', codex: '2.1.0' })

    const { result } = renderHook(() => useCliVersionStatuses([CodeCli.CLAUDE_CODE, CodeCli.OPENAI_CODEX]))

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.canUpgrade).toBe(true))
    expect(result.current[CodeCli.OPENAI_CODEX]?.canUpgrade).toBe(true)

    setSnapshots({ claude: miseSnapshot('claude', 'claude', '1.1.0'), codex: miseSnapshot('codex', 'codex', '2.0.0') })
    act(() => {
      ipcEventHandlers.get('binary.availability_changed')?.(undefined)
    })

    await waitFor(() => expect(result.current[CodeCli.CLAUDE_CODE]?.current).toBe('1.1.0'))
    expect(result.current[CodeCli.CLAUDE_CODE]).toMatchObject({ current: '1.1.0', latest: '1.1.0', canUpgrade: false })
    expect(result.current[CodeCli.OPENAI_CODEX]).toMatchObject({ current: '2.0.0', latest: '2.1.0', canUpgrade: true })
  })
})
