import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelWithStatus } from '../../types/healthCheck'
import { HealthStatus } from '../../types/healthCheck'
import { useHealthCheck } from '../useHealthCheck'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const useProviderMetaMock = vi.fn()
const checkModelsHealthMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth', () => ({
  checkModelsHealth: (...args: any[]) => checkModelsHealthMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: () => useAuthenticationApiKeyMock()
}))

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: (...args: any[]) => toastErrorMock(...args),
    success: (...args: any[]) => toastSuccessMock(...args)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn() })
  }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string, options?: object) => `${key}${options ? `:${JSON.stringify(options)}` : ''}` }
}))

const chatModel: Model = {
  id: 'openai::gpt-4o',
  providerId: 'openai',
  name: 'GPT-4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}
const rerankModel: Model = {
  id: 'openai::rerank-1',
  providerId: 'openai',
  name: 'Rerank',
  capabilities: [MODEL_CAPABILITY.RERANK],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false
}
const imageModel: Model = {
  id: 'openai::gpt-image-1',
  providerId: 'openai',
  name: 'GPT Image',
  capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false
}
const primaryKey = { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true }
const backupKey = { id: 'key-2', key: 'sk-backup', label: 'Backup', isEnabled: true }

function okResult(model = chatModel, key = primaryKey): ModelWithStatus {
  return {
    kind: 'ok',
    model,
    status: HealthStatus.SUCCESS,
    checking: false,
    latency: 12,
    keyResults: [
      {
        kind: 'ok',
        credential: { kind: 'api-key', entry: key },
        status: HealthStatus.SUCCESS,
        checking: false,
        latency: 12
      }
    ]
  }
}

describe('useHealthCheck', () => {
  let apiKeys = [primaryKey, backupKey]
  let models = [chatModel, imageModel, rerankModel]
  let inputApiKey = 'sk-primary,sk-backup'
  let hasPendingSync = false
  const commitInputApiKeyNow = vi.fn()
  const refetchApiKeys = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    apiKeys = [primaryKey, backupKey]
    models = [chatModel, imageModel, rerankModel]
    inputApiKey = 'sk-primary,sk-backup'
    hasPendingSync = false
    commitInputApiKeyNow.mockResolvedValue(undefined)
    refetchApiKeys.mockImplementation(async () => ({ keys: apiKeys }))
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
    useModelsMock.mockImplementation(() => ({ models }))
    useProviderApiKeysMock.mockImplementation(() => ({ data: { keys: apiKeys }, refetch: refetchApiKeys }))
    useAuthenticationApiKeyMock.mockImplementation(() => ({ commitInputApiKeyNow, hasPendingSync, inputApiKey }))
    useProviderEndpointsMock.mockReturnValue({ apiHost: 'https://api.openai.com', anthropicApiHost: '' })
    useProviderMetaMock.mockReturnValue({ isApiKeyFieldVisible: true })
  })

  it('starts in the background and streams results into their original model rows', async () => {
    let finishCheck: ((results: ModelWithStatus[]) => void) | undefined
    let onChecked: ((result: ModelWithStatus, index: number) => void) | undefined
    checkModelsHealthMock.mockImplementation(
      (options, callback) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          onChecked = callback
          finishCheck = resolve
          expect(options.models).toEqual([chatModel, rerankModel])
        })
    )

    const { result } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(true)
    })

    expect(result.current.isChecking).toBe(true)
    expect(result.current.modelStatuses).toEqual([
      expect.objectContaining({ kind: 'checking', model: chatModel }),
      expect.objectContaining({ kind: 'skipped', model: imageModel }),
      expect.objectContaining({ kind: 'checking', model: rerankModel })
    ])

    act(() => onChecked?.(okResult(rerankModel), 1))
    expect(result.current.modelStatuses[2]).toMatchObject({ kind: 'ok', model: rerankModel })

    await act(async () => {
      finishCheck?.([okResult(chatModel), okResult(rerankModel)])
      await Promise.resolve()
    })

    expect(result.current.isChecking).toBe(false)
    expect(result.current.modelStatuses[0]).toMatchObject({ kind: 'ok', model: chatModel })
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('model_status_skipped'))
  })

  it('enters the shared loading state while credentials are still being prepared', async () => {
    let resolveCommit!: () => void
    commitInputApiKeyNow.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCommit = resolve
      })
    )
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result } = renderHook(() => useHealthCheck('openai'))

    let startTask!: Promise<boolean>
    act(() => {
      startTask = result.current.startHealthCheck({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 15000
      })
    })

    expect(result.current.isChecking).toBe(true)
    expect(checkModelsHealthMock).not.toHaveBeenCalled()

    await act(async () => {
      resolveCommit()
      await expect(startTask).resolves.toBe(true)
    })
    await waitFor(() => expect(result.current.isChecking).toBe(false))
  })

  it('does not duplicate API key save failure feedback before stopping', async () => {
    commitInputApiKeyNow.mockImplementationOnce(async () => {
      toastErrorMock('settings.provider.api_key.save_failed')
      throw new Error('save failed')
    })
    const { result } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(result.current.isChecking).toBe(false)
    expect(refetchApiKeys).not.toHaveBeenCalled()
    expect(checkModelsHealthMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('settings.provider.api_key.save_failed')
    expect(toastErrorMock).not.toHaveBeenCalledWith('settings.models.check.failed_to_start')
  })

  it('surfaces API key refresh failures without starting checks', async () => {
    refetchApiKeys.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(result.current.isChecking).toBe(false)
    expect(commitInputApiKeyNow).toHaveBeenCalled()
    expect(checkModelsHealthMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith('settings.models.check.failed_to_start')
  })

  it('accepts the credential refresh caused by its own preflight save', async () => {
    let resolveRefetch!: (value: { keys: typeof apiKeys }) => void
    refetchApiKeys.mockReturnValueOnce(
      new Promise<{ keys: typeof apiKeys }>((resolve) => {
        resolveRefetch = resolve
      })
    )
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result, rerender } = renderHook(() => useHealthCheck('openai'))

    let startTask!: Promise<boolean>
    act(() => {
      startTask = result.current.startHealthCheck({
        keySelection: { mode: 'all' },
        isConcurrent: true,
        timeout: 15000
      })
    })
    await waitFor(() => expect(refetchApiKeys).toHaveBeenCalled())

    apiKeys = apiKeys.map((entry) =>
      entry.id === primaryKey.id ? { ...entry, label: 'Saved during preflight' } : entry
    )
    rerender()

    await act(async () => {
      resolveRefetch({ keys: apiKeys })
      await expect(startTask).resolves.toBe(true)
    })

    expect(checkModelsHealthMock).toHaveBeenCalledTimes(1)
  })

  it('commits pending keys, refetches, then resolves one selected enabled key by id', async () => {
    apiKeys = [primaryKey]
    const latestBackup = { ...backupKey, label: 'Latest backup' }
    refetchApiKeys.mockResolvedValue({ keys: [primaryKey, latestBackup] })
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel, latestBackup), okResult(rerankModel, latestBackup)])

    const { result } = renderHook(() => useHealthCheck('openai'))

    await act(async () => {
      await result.current.startHealthCheck({
        keySelection: { mode: 'single', keyId: latestBackup.id },
        isConcurrent: false,
        timeout: 5000
      })
    })

    expect(commitInputApiKeyNow.mock.invocationCallOrder[0]).toBeLessThan(refetchApiKeys.mock.invocationCallOrder[0])
    expect(refetchApiKeys.mock.invocationCallOrder[0]).toBeLessThan(checkModelsHealthMock.mock.invocationCallOrder[0])
    expect(checkModelsHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: [{ kind: 'api-key', entry: latestBackup }],
        isConcurrent: false,
        timeout: 5000
      }),
      expect.any(Function)
    )
  })

  it('keeps existing results when preflight cannot resolve an enabled key', async () => {
    checkModelsHealthMock.mockResolvedValueOnce([okResult(chatModel), okResult(rerankModel)])
    const { result } = renderHook(() => useHealthCheck('openai'))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    const previousResults = result.current.modelStatuses

    apiKeys = [{ ...primaryKey, isEnabled: false }]
    refetchApiKeys.mockResolvedValue({ keys: apiKeys })
    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(result.current.modelStatuses).toBe(previousResults)
    expect(checkModelsHealthMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalled()
  })

  it('uses provider authentication for login-based providers even when API keys exist', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'oauth-provider', name: 'OAuth Provider', authMethods: ['oauth'] }
    })
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result } = renderHook(() => useHealthCheck('oauth-provider'))

    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    expect(checkModelsHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: [{ kind: 'provider-auth', id: 'provider-auth', key: '' }]
      }),
      expect.any(Function)
    )
  })

  it('uses explicit API keys for auth-optional providers when enabled keys exist', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama', authOptional: true, authMethods: ['api-key'] }
    })
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result } = renderHook(() => useHealthCheck('ollama'))

    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    expect(checkModelsHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: [
          { kind: 'api-key', entry: primaryKey },
          { kind: 'api-key', entry: backupKey }
        ]
      }),
      expect.any(Function)
    )
  })

  it('retains an active run across synchronized key enablement changes', async () => {
    let signal: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(
      (options) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          signal = options.signal
          options.signal.addEventListener('abort', () => resolve([]), { once: true })
        })
    )
    const { result, rerender } = renderHook(({ providerId }) => useHealthCheck(providerId), {
      initialProps: { providerId: 'openai' }
    })
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    apiKeys = apiKeys.map((entry) => (entry.id === primaryKey.id ? { ...entry, isEnabled: false } : entry))
    inputApiKey = 'sk-backup'
    rerender({ providerId: 'openai' })
    expect(signal?.aborted).toBe(false)
    expect(result.current.isChecking).toBe(true)
    expect(result.current.modelStatuses).not.toEqual([])
  })

  it('aborts and clears an active run on each pending credential draft edit', async () => {
    const signals: AbortSignal[] = []
    checkModelsHealthMock.mockImplementation(
      (options) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          signals.push(options.signal)
          options.signal.addEventListener('abort', () => resolve([]), { once: true })
        })
    )
    const { result, rerender } = renderHook(() => useHealthCheck('openai'))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    inputApiKey = 'sk-edited,sk-backup'
    hasPendingSync = true
    rerender()
    expect(signals[0].aborted).toBe(true)
    expect(result.current.isChecking).toBe(false)
    expect(result.current.modelStatuses).toEqual([])

    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    inputApiKey = 'sk-edited-again,sk-backup'
    rerender()
    expect(signals[1].aborted).toBe(true)
    expect(result.current.isChecking).toBe(false)
    expect(result.current.modelStatuses).toEqual([])
  })

  it('drops late callbacks after a provider switch', async () => {
    let onChecked: ((result: ModelWithStatus, index: number) => void) | undefined
    checkModelsHealthMock.mockImplementation(
      (options, callback) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          onChecked = callback
          options.signal.addEventListener('abort', () => resolve([]), { once: true })
        })
    )
    const { result, rerender } = renderHook(({ providerId }) => useHealthCheck(providerId), {
      initialProps: { providerId: 'openai' }
    })
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    rerender({ providerId: 'anthropic' })
    act(() => onChecked?.(okResult(chatModel), 0))
    expect(result.current.modelStatuses).toEqual([])
  })

  it('prunes only deleted model results after a completed run', async () => {
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result, rerender } = renderHook(() => useHealthCheck('openai'))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    models = [rerankModel]
    rerender()

    await waitFor(() => expect(result.current.modelStatuses.map((status) => status.model.id)).toEqual([rerankModel.id]))
  })

  it('aborts the background run on unmount', async () => {
    let signal: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(
      (options) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          signal = options.signal
          options.signal.addEventListener('abort', () => resolve([]), { once: true })
        })
    )
    const { result, unmount } = renderHook(() => useHealthCheck('openai'))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
