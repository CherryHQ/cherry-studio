import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ModelCheckCredentialsSaveError,
  type ModelCheckCredentialsState
} from '../../hooks/providerSetting/useModelCheckCredentials'
import type { ModelWithStatus } from '../../types/healthCheck'
import { HealthStatus } from '../../types/healthCheck'
import { ModelCheckCredentialsError } from '../../utils/healthCheck'
import { readModelHealthStatus } from '../modelHealthStatusCache'
import { useHealthCheck } from '../useHealthCheck'

const useProviderByIdMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const checkModelsHealthMock = vi.fn()
const prepareCredentialsMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderById: (...args: any[]) => useProviderByIdMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth', () => ({
  checkModelsHealth: (...args: any[]) => checkModelsHealthMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
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
  capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
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
  let models = [chatModel, imageModel, rerankModel]
  let credentialChangeVersion = 0

  const getCredentialsState = (): ModelCheckCredentialsState => ({
    apiKeyEntries: [primaryKey, backupKey],
    canSelectApiKey: true,
    requiresApiKey: true,
    credentialChangeVersion,
    prepareCredentials: prepareCredentialsMock
  })

  /** The rows read their own cache key, so assert on what a row would render. */
  const readStatuses = (list: readonly Model[] = models) =>
    list.flatMap((model) => readModelHealthStatus(model.id) ?? [])

  beforeEach(() => {
    vi.clearAllMocks()
    MockCacheUtils.resetMocks()
    models = [chatModel, imageModel, rerankModel]
    credentialChangeVersion = 0
    prepareCredentialsMock.mockResolvedValue([
      { kind: 'api-key', entry: primaryKey },
      { kind: 'api-key', entry: backupKey }
    ])
    useProviderByIdMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
    useModelsMock.mockImplementation(() => ({ models }))
    useProviderEndpointsMock.mockReturnValue({ apiHost: 'https://api.openai.com', anthropicApiHost: '' })
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

    const { result } = renderHook(() => useHealthCheck('openai', getCredentialsState()))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(true)
    })

    expect(result.current.isChecking).toBe(true)
    expect(readStatuses()).toEqual([
      expect.objectContaining({ kind: 'checking', model: chatModel }),
      expect.objectContaining({ kind: 'skipped', model: imageModel }),
      expect.objectContaining({ kind: 'checking', model: rerankModel })
    ])

    act(() => onChecked?.(okResult(rerankModel), 1))
    expect(readModelHealthStatus(rerankModel.id)).toMatchObject({ kind: 'ok', model: rerankModel })

    await act(async () => {
      finishCheck?.([okResult(chatModel), okResult(rerankModel)])
      await Promise.resolve()
    })

    expect(result.current.isChecking).toBe(false)
    expect(readModelHealthStatus(chatModel.id)).toMatchObject({ kind: 'ok', model: chatModel })
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('model_status_skipped'))
  })

  it('uses the latest models after credentials are prepared', async () => {
    let resolveCommit!: () => void
    models = [imageModel]
    prepareCredentialsMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCommit = resolve
      }).then(() => [{ kind: 'api-key' as const, entry: primaryKey }])
    )
    const reclassifiedModel = {
      ...imageModel,
      name: 'Image Model Reclassified',
      capabilities: [MODEL_CAPABILITY.TEXT_GENERATION]
    }
    checkModelsHealthMock.mockResolvedValue([okResult(reclassifiedModel)])
    const { result, rerender } = renderHook(() => useHealthCheck('openai', getCredentialsState()))

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

    models = [reclassifiedModel]
    rerender()

    await act(async () => {
      resolveCommit()
      await expect(startTask).resolves.toBe(true)
    })
    await waitFor(() => expect(result.current.isChecking).toBe(false))
    expect(checkModelsHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({ models: [reclassifiedModel] }),
      expect.any(Function)
    )
    expect(toastSuccessMock).not.toHaveBeenCalledWith(expect.stringContaining('model_status_skipped'))
  })

  it('does not duplicate API key save failure feedback before stopping', async () => {
    prepareCredentialsMock.mockImplementationOnce(async () => {
      toastErrorMock('settings.provider.api_key.save_failed')
      throw new ModelCheckCredentialsSaveError(new Error('save failed'))
    })
    const { result } = renderHook(() => useHealthCheck('openai', getCredentialsState()))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(result.current.isChecking).toBe(false)
    expect(checkModelsHealthMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('settings.provider.api_key.save_failed')
    expect(toastErrorMock).not.toHaveBeenCalledWith('settings.models.check.failed_to_start')
  })

  it('surfaces API key refresh failures without starting checks', async () => {
    prepareCredentialsMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => useHealthCheck('openai', getCredentialsState()))

    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(result.current.isChecking).toBe(false)
    expect(checkModelsHealthMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith('settings.models.check.failed_to_start')
  })

  it('keeps existing results when preflight cannot resolve an enabled key', async () => {
    checkModelsHealthMock.mockResolvedValueOnce([okResult(chatModel), okResult(rerankModel)])
    const { result } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    const previousResults = readStatuses()

    prepareCredentialsMock.mockRejectedValueOnce(new ModelCheckCredentialsError('api_key_required'))
    await act(async () => {
      await expect(
        result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
      ).resolves.toBe(false)
    })

    expect(readStatuses()).toEqual(previousResults)
    expect(checkModelsHealthMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalled()
  })

  it('retains an active run while the shared credential version is unchanged', async () => {
    let signal: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(
      (options) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          signal = options.signal
          options.signal.addEventListener('abort', () => resolve([]), { once: true })
        })
    )
    const { result, rerender } = renderHook(({ providerId }) => useHealthCheck(providerId, getCredentialsState()), {
      initialProps: { providerId: 'openai' }
    })
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    rerender({ providerId: 'openai' })
    expect(signal?.aborted).toBe(false)
    expect(result.current.isChecking).toBe(true)
    expect(readStatuses()).not.toEqual([])
  })

  it('reconciles a completed run against model edits made in flight', async () => {
    let finishCheck: ((results: ModelWithStatus[]) => void) | undefined
    let signal: AbortSignal | undefined
    checkModelsHealthMock.mockImplementation(
      (options) =>
        new Promise<ModelWithStatus[]>((resolve) => {
          finishCheck = resolve
          signal = options.signal
        })
    )
    const { result, rerender } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    const renamedChatModel = { ...chatModel, name: 'GPT-4o Renamed' }
    models = [
      renamedChatModel,
      { ...imageModel, capabilities: [MODEL_CAPABILITY.TEXT_GENERATION] },
      { ...rerankModel, endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] }
    ]
    rerender()
    expect(signal?.aborted).toBe(false)

    await act(async () => {
      finishCheck?.([okResult(chatModel), okResult(rerankModel)])
      await Promise.resolve()
    })

    await waitFor(() => expect(readStatuses()).toEqual([expect.objectContaining({ model: renamedChatModel })]))
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining('model_status_passed:{\\"count\\":1}'))
    expect(toastSuccessMock).not.toHaveBeenCalledWith(expect.stringContaining('model_status_skipped'))
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
    const { result, rerender } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    credentialChangeVersion += 1
    rerender()
    expect(signals[0].aborted).toBe(true)
    expect(result.current.isChecking).toBe(false)
    expect(readStatuses()).toEqual([])

    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    credentialChangeVersion += 1
    rerender()
    expect(signals[1].aborted).toBe(true)
    expect(result.current.isChecking).toBe(false)
    expect(readStatuses()).toEqual([])
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
    const { result, rerender } = renderHook(({ providerId }) => useHealthCheck(providerId, getCredentialsState()), {
      initialProps: { providerId: 'openai' }
    })
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    rerender({ providerId: 'anthropic' })
    act(() => onChecked?.(okResult(chatModel), 0))
    expect(readStatuses()).toEqual([])
  })

  it('prunes only deleted model results after a completed run', async () => {
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result, rerender } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    models = [rerankModel]
    rerender()

    await waitFor(() => expect(readModelHealthStatus(chatModel.id)).toBeUndefined())
    expect(readModelHealthStatus(rerankModel.id)).toMatchObject({ model: rerankModel })
  })

  it('clears cached results on unmount so a later mount never renders them', async () => {
    checkModelsHealthMock.mockResolvedValue([okResult(chatModel), okResult(rerankModel)])
    const { result, unmount } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })
    expect(readStatuses()).not.toEqual([])

    unmount()
    expect(readStatuses()).toEqual([])
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
    const { result, unmount } = renderHook(() => useHealthCheck('openai', getCredentialsState()))
    await act(async () => {
      await result.current.startHealthCheck({ keySelection: { mode: 'all' }, isConcurrent: true, timeout: 15000 })
    })

    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
