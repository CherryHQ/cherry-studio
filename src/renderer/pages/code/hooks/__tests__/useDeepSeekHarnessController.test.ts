import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  openSmartMiniApp: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const { useDeepSeekHarnessController } = await import('../useDeepSeekHarnessController')

const emitStatusChanged = (payload: Record<string, unknown>) => {
  cacheService.setShared('feature.deepseek_harness.status', payload as never)
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
    cacheService.deleteShared('feature.deepseek_harness.status')
    vi.spyOn(Date, 'now').mockReturnValue(1_776_000_000_000)
    mocks.request.mockImplementation((route: string) => {
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
      if (route === 'deepseek_harness.start') return Promise.resolve({ success: false, message: 'config collision' })
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()
    await act(async () => result.current.onLaunch())
    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({ message: 'config collision' }),
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'config collision', operation: 'deepseek_harness.start' }),
          localizedErrorMessage: 'code.launch.error'
        }),
        title: 'code.launch.error'
      })
    )
  })

  it('tracks managed status via pushed events, reopens the current URL, and stops only through the managed IPC', async () => {
    cacheService.setShared('feature.deepseek_harness.status', {
      status: 'running',
      url: 'http://127.0.0.1:45231'
    })
    mocks.request.mockImplementation((route: string) => {
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

  it('keeps the raw stop failure and reports that the service did not stop', async () => {
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.stop') return Promise.resolve({ success: false, message: 'port still held' })
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()

    let stopped = true
    await act(async () => {
      stopped = await result.current.onStop()
    })

    expect(stopped).toBe(false)
    expect(mocks.request).toHaveBeenCalledWith('deepseek_harness.stop')
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({ message: 'port still held' }),
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'port still held', operation: 'deepseek_harness.stop' }),
          localizedErrorMessage: 'code.stop_failed'
        }),
        title: 'code.stop_failed'
      })
    )
  })

  it('keeps a thrown stop error, resets stopping, and reports that the service did not stop', async () => {
    const stopError = new Error('gateway socket closed')
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.stop') return Promise.reject(stopError)
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()

    let stopped = true
    await act(async () => {
      stopped = await result.current.onStop()
    })

    expect(stopped).toBe(false)
    expect(result.current.stopping).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: stopError,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({
            message: 'gateway socket closed',
            operation: 'deepseek_harness.stop',
            source: 'code.deepseek'
          }),
          localizedErrorMessage: 'code.stop_failed'
        }),
        title: 'code.stop_failed'
      })
    )
  })

  it('keeps a thrown launch rejection, resets launching, and can launch again', async () => {
    const failure = new Error('harness ipc rejected')
    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.start') return Promise.reject(failure)
      return Promise.resolve({ success: true })
    })
    const { result } = renderController()

    let outcome: unknown = 'pending'
    await act(async () => {
      outcome = await result.current.onLaunch()
    })

    expect(outcome).toBeUndefined()
    expect(result.current.launching).toBe(false)
    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({
            message: 'harness ipc rejected',
            operation: 'deepseek_harness.start',
            source: 'code.deepseek'
          }),
          localizedErrorMessage: 'code.launch.error'
        }),
        title: 'code.launch.error'
      })
    )

    mocks.request.mockImplementation((route: string) => {
      if (route === 'deepseek_harness.start') return Promise.resolve({ success: true, url: 'http://127.0.0.1:43123' })
      return Promise.resolve({ success: true })
    })
    await act(async () => {
      await result.current.onLaunch()
    })
    expect(mocks.openSmartMiniApp).toHaveBeenCalledOnce()
  })

  it('keeps the not-running Web UI error instead of a caption-only toast', async () => {
    const { result } = renderController()

    await act(async () => {
      await result.current.onOpenWebUi()
    })

    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({ message: 'DeepSeek Harness Web UI is not running' }),
        data: expect.objectContaining({
          errorContext: expect.objectContaining({
            message: 'DeepSeek Harness Web UI is not running',
            operation: 'deepseek_harness.open_web_ui',
            source: 'code.deepseek'
          }),
          localizedErrorMessage: 'code.launch.error'
        }),
        title: 'code.launch.error'
      })
    )
    expect(mocks.toastError).not.toHaveBeenCalledWith('code.launch.error')
  })
})
