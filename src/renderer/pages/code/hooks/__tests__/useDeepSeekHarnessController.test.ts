import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  useIpcOn: vi.fn(),
  events: new Map<string, (payload: Record<string, unknown>) => void>(),
  openSmartMiniApp: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request }, useIpcOn: mocks.useIpcOn }))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const { useDeepSeekHarnessController } = await import('../useDeepSeekHarnessController')

const emitStatusChanged = (payload: Record<string, unknown>) => {
  const handler = mocks.events.get('deepseek_harness.status_changed')
  if (!handler) throw new Error('status_changed handler not registered')
  handler(payload)
}

const directProvider = { id: 'anthropic', name: 'Anthropic' } as Provider

function renderController(provider: Provider = directProvider) {
  return renderHook(() =>
    useDeepSeekHarnessController({
      selectedCliTool: CodeCli.DEEPSEEK_HARNESS,
      enabledProvider: provider,
      currentProviderConfig: {
        modelId: 'anthropic::claude-sonnet',
        config: { agentPreset: 'code', permissionMode: 'read-only' }
      },
      upsertProviderConfig: vi.fn(),
      setCurrentProvider: vi.fn()
    })
  )
}

describe('useDeepSeekHarnessController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_776_000_000_000)
    mocks.events.clear()
    mocks.useIpcOn.mockImplementation((event: string, handler: (payload: Record<string, unknown>) => void) => {
      mocks.events.set(event, handler)
    })
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'deepseek_harness.start') {
        return Promise.resolve({ success: true, url: 'http://127.0.0.1:43123' })
      }
      return Promise.resolve({ success: true })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('starts directly without passing a directory, terminal, URL, port, or key and opens the Mini App', async () => {
    const { result } = renderController()
    await act(async () => result.current.onLaunch())

    expect(mocks.request).toHaveBeenCalledWith('deepseek_harness.start', {
      mode: 'direct',
      uniqueModelId: 'anthropic::claude-sonnet',
      agentPreset: 'code',
      permissionMode: 'read-only'
    })
    const descriptor = mocks.openSmartMiniApp.mock.calls[0][0]
    expect(descriptor).toMatchObject({
      appId: 'deepseek-harness-web',
      name: 'DeepSeek Harness',
      logo: 'deepseek'
    })
    expect(new URL(descriptor.url).searchParams.get('cherry_navigation_revision')).toBe('1776000000000')
    // Running state is no longer written locally — it arrives as a main-pushed event.
    await act(async () => {
      emitStatusChanged({ status: 'running', url: 'http://127.0.0.1:43123' })
    })
    expect(result.current.running).toBe(true)
  })

  it('uses gateway mode for the synthetic gateway provider', async () => {
    const { result } = renderController({ id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Gateway' } as Provider)
    await act(async () => result.current.onLaunch())
    expect(mocks.request).toHaveBeenCalledWith('deepseek_harness.start', {
      mode: 'gateway',
      uniqueModelId: 'anthropic::claude-sonnet',
      agentPreset: 'code',
      permissionMode: 'read-only'
    })
  })

  it('uses safe defaults when an old provider config has no Harness settings', async () => {
    const { result } = renderHook(() =>
      useDeepSeekHarnessController({
        selectedCliTool: CodeCli.DEEPSEEK_HARNESS,
        enabledProvider: directProvider,
        currentProviderConfig: { modelId: 'anthropic::claude-sonnet' },
        upsertProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn()
      })
    )

    await act(async () => result.current.onLaunch())

    expect(mocks.request).toHaveBeenCalledWith('deepseek_harness.start', {
      mode: 'direct',
      uniqueModelId: 'anthropic::claude-sonnet',
      agentPreset: 'inherit',
      permissionMode: 'workspace-write'
    })
  })

  it('does not open a Mini App when main rejects the launch', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.get_status') return Promise.resolve({ status: 'stopped' })
      if (route === 'deepseek_harness.start') return Promise.resolve({ success: false, message: 'config collision' })
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()
    await act(async () => result.current.onLaunch())
    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('config collision')
  })

  it('tracks managed status via pushed events, reopens the current URL, and stops only through the managed IPC', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.get_status') {
        return Promise.resolve({ status: 'running', url: 'http://127.0.0.1:45231' })
      }
      if (route === 'deepseek_harness.stop') return Promise.resolve({ success: true })
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()
    await waitFor(() => expect(result.current.running).toBe(true))

    await act(async () => result.current.onOpenWebUi())
    expect(mocks.openSmartMiniApp).toHaveBeenCalledOnce()

    // A kill surfaces immediately through the pushed event — no 5s polling wait.
    await act(async () => {
      emitStatusChanged({ status: 'error' })
    })
    expect(result.current.running).toBe(false)

    await act(async () => {
      await result.current.onStop()
    })
    expect(mocks.request).toHaveBeenCalledWith('deepseek_harness.stop')
  })
})
