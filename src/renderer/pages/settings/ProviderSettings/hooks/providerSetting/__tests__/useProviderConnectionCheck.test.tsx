import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HealthStatus, type ModelCheckCredential } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type * as HealthCheckUtils from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
import type * as ToastServiceModule from '@renderer/services/toast'
import { classifyError } from '@renderer/utils/errorClassifier'
import { errorToastPresentations, serializeToastError } from '@renderer/utils/errorToast'
import type { ApiKeyEntry } from '@shared/data/types/provider'

import { ModelCheckCredentialsSaveError, type ModelCheckCredentialsState } from '../useModelCheckCredentials'
import { useProviderConnectionCheck } from '../useProviderConnectionCheck'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const checkModelWithMultipleKeysMock = vi.fn()
const enableProviderMock = vi.fn()
const prepareCredentialsMock = vi.fn()

let apiKeyEntries: ApiKeyEntry[]
let credentialChangeVersion = 0

vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  const { getToastUtilities } = await import('@cherrystudio/ui/components/primitives/toast')
  return { ...MockCherrystudioUI, getToastUtilities }
})

vi.mock('@renderer/services/toast', async (importOriginal) => {
  const { toast: actual } = await importOriginal<typeof ToastServiceModule>()
  return {
    toast: {
      ...actual,
      error: vi.fn(actual.error),
      warning: vi.fn(actual.warning),
      success: vi.fn(actual.success),
      errorFromException: vi.fn(actual.errorFromException)
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { t: (key: string) => key }
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('../useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/utils/healthCheck', async () => {
  const actual = await vi.importActual<typeof HealthCheckUtils>(
    '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
  )
  return {
    ...actual,
    checkModelWithMultipleKeys: (...args: any[]) => checkModelWithMultipleKeysMock(...args)
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

const model = {
  id: 'cherryin::claude-4-sonnet',
  name: 'Claude 4 Sonnet',
  providerId: 'cherryin',
  capabilities: []
} as never

function successfulResult(credential: ModelCheckCredential, latency = 120) {
  return {
    kind: 'ok' as const,
    credential,
    status: HealthStatus.SUCCESS,
    checking: false as const,
    latency
  }
}

function failedResult(credential: ModelCheckCredential, message = 'Unauthorized') {
  return {
    kind: 'failed' as const,
    credential,
    status: HealthStatus.FAILED,
    checking: false as const,
    error: { name: 'ProviderError', message, stack: null }
  }
}

describe('useProviderConnectionCheck', () => {
  const getCredentialsState = (): ModelCheckCredentialsState => ({
    apiKeyEntries,
    canSelectApiKey: true,
    requiresApiKey: true,
    credentialChangeVersion,
    prepareCredentials: prepareCredentialsMock
  })

  beforeEach(() => {
    vi.clearAllMocks()
    toast.closeAll()
    enableProviderMock.mockReset()
    credentialChangeVersion = 0
    apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-backup', label: 'Backup', isEnabled: true }
    ]
    prepareCredentialsMock.mockImplementation(async () =>
      apiKeyEntries.filter((entry) => entry.isEnabled).map((entry) => ({ kind: 'api-key' as const, entry }))
    )

    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useModelsMock.mockReturnValue({ models: [model] })
    useProviderEndpointsMock.mockReturnValue({
      apiHost: 'https://open.cherryin.net',
      anthropicApiHost: 'https://open.cherryin.net'
    })
  })

  it('checks all prepared credentials concurrently', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials) =>
      credentials.map((credential: ModelCheckCredential) => successfulResult(credential))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(outcome).toBe('passed')
    expect(prepareCredentialsMock.mock.invocationCallOrder[0]).toBeLessThan(
      checkModelWithMultipleKeysMock.mock.invocationCallOrder[0]
    )
    expect(checkModelWithMultipleKeysMock).toHaveBeenCalledWith(
      model,
      [
        { kind: 'api-key', entry: apiKeyEntries[0] },
        { kind: 'api-key', entry: apiKeyEntries[1] }
      ],
      15000,
      expect.any(AbortSignal)
    )
    expect(result.current.singleModelResult?.keyResults).toHaveLength(2)
    expect(result.current.isSingleModelChecking).toBe(false)
    expect(enableProviderMock).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalled()
  })

  it('keeps the complete per-key report when any API key fails', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) => [
      successfulResult(credentials[0]),
      failedResult(credentials[1], 'Quota exceeded')
    ])
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(outcome).toBe('failed')
    expect(result.current.singleModelResult?.kind).toBe('failed')
    expect(result.current.singleModelResult?.keyResults).toEqual([
      expect.objectContaining({ status: HealthStatus.SUCCESS }),
      expect.objectContaining({
        status: HealthStatus.FAILED,
        error: expect.objectContaining({ message: 'Quota exceeded' })
      })
    ])
    expect(enableProviderMock).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not enable the provider when every API key fails', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => failedResult(credential))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(enableProviderMock).not.toHaveBeenCalled()
    expect(result.current.singleModelResult?.kind).toBe('failed')
  })

  it('retries a failed probe without producing a second completion notification', async () => {
    checkModelWithMultipleKeysMock.mockImplementationOnce(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => failedResult(credential, 'fetch failed'))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))
    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    const retry = vi.mocked(toast.errorFromException).mock.calls[0][1]?.actions?.retry
    expect(retry).toBeDefined()
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    await act(async () => {
      expect(await retry!()).toBe(true)
    })
    expect(result.current.singleModelResult?.kind).toBe('ok')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps retry enablement failures in the owning toast (dismissed: %s)', async (dismissed) => {
    checkModelWithMultipleKeysMock.mockImplementationOnce(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => failedResult(credential, 'fetch failed'))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))
    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    const original = toast.getToastQueue().toasts[0]
    expect(original.action).toBeDefined()
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    let rejectEnable!: (error: Error) => void
    enableProviderMock.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectEnable = reject)))
    let recovery!: Promise<void>
    await act(async () => {
      recovery = Promise.resolve(original.action!.onClick())
    })
    await waitFor(() => expect(enableProviderMock).toHaveBeenCalledOnce())
    expect(toast.getToastQueue().toasts[0]).toMatchObject({ key: original.key, type: 'loading' })
    if (dismissed) toast.closeToast(original.key)
    await act(async () => {
      rejectEnable(new Error('Enablement unavailable'))
      await recovery
    })
    if (dismissed) expect(toast.getToastQueue().toasts).toEqual([])
    else
      expect(toast.getToastQueue().toasts).toEqual([
        expect.objectContaining({
          key: original.key,
          type: 'error',
          title: 'settings.provider.enable_failed_after_connection'
        })
      ])
    expect(result.current.singleModelResult?.kind).toBe('ok')
    expect(toast.warning).not.toHaveBeenCalled()
    toast.closeAll()
    enableProviderMock.mockRejectedValueOnce(new Error('Enablement unavailable'))
    await act(async () => {
      expect(await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })).toBe('passed')
    })
    expect(toast.getToastQueue().toasts.map(({ type }) => type)).toEqual(['warning', 'success'])
  })

  it.each([
    { statusCode: 401, message: 'Invalid credentials', category: 'auth', action: 'configure' },
    { statusCode: 429, message: 'Resource exhausted', category: 'rate_limit', action: 'retry' }
  ])(
    'preserves $category recovery for initial and retry failures',
    async ({ statusCode, message, category, action }) => {
      const failure = { name: 'ProviderError', message, stack: null, statusCode }
      checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
        credentials.map((credential) => ({ ...failedResult(credential), error: failure }))
      )
      const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))
      await act(async () => {
        expect(await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })).toBe('failed')
      })

      const [reportedError, context] = vi.mocked(toast.errorFromException).mock.calls[0]
      expect(reportedError).toEqual(failure)
      const diagnosis = classifyError(serializeToastError(reportedError), 'cherryin')
      expect(diagnosis.category).toBe(category)
      expect(errorToastPresentations[diagnosis.category].action).toBe(action)

      const retry = context?.actions?.retry
      expect(retry).toBeDefined()
      let retryError: unknown
      await act(async () => {
        retryError = await Promise.resolve(retry!()).catch((error: unknown) => error)
      })
      expect(retryError).toEqual(failure)
      const retryDiagnosis = classifyError(serializeToastError(retryError), 'cherryin')
      expect(retryDiagnosis.category).toBe(category)
      expect(errorToastPresentations[retryDiagnosis.category].action).toBe(action)
      expect(toast.errorFromException).toHaveBeenCalledOnce()
      expect(toast.success).not.toHaveBeenCalled()
    }
  )

  it('uses the first failed credential for mixed-error feedback while retaining every result', async () => {
    apiKeyEntries.push({ id: 'key-3', key: 'sk-third', label: 'Third', isEnabled: true })
    const firstFailure = {
      name: 'ProviderError',
      message: 'Resource exhausted',
      stack: null,
      statusCode: 429,
      providerErrorCategory: 'quota'
    }
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) => [
      successfulResult(credentials[0]),
      { ...failedResult(credentials[1]), error: firstFailure },
      {
        ...failedResult(credentials[2], 'Invalid credentials'),
        error: { name: 'ProviderError', message: 'Invalid credentials', stack: null, statusCode: 401 }
      }
    ])
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))
    await act(async () => {
      expect(await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })).toBe('failed')
    })

    const reportedError = vi.mocked(toast.errorFromException).mock.calls[0][0]
    expect(reportedError).toEqual(firstFailure)
    const diagnosis = classifyError(serializeToastError(reportedError))
    expect(diagnosis.category).toBe('quota')
    expect(errorToastPresentations[diagnosis.category].action).toBe('billing')
    expect(result.current.singleModelResult?.keyResults).toEqual([
      expect.objectContaining({ kind: 'ok' }),
      expect.objectContaining({ error: firstFailure }),
      expect.objectContaining({ error: expect.objectContaining({ statusCode: 401 }) })
    ])
    const retry = vi.mocked(toast.errorFromException).mock.calls[0][1]?.actions?.retry
    enableProviderMock.mockRejectedValueOnce(new Error('Enablement unavailable'))
    await act(async () => {
      await expect(retry!()).rejects.toEqual(firstFailure)
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('leaves save failure feedback to the API key owner before stopping', async () => {
    prepareCredentialsMock.mockRejectedValueOnce(new ModelCheckCredentialsSaveError(new Error('save failed')))
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(outcome).toBe('failed')
    expect(checkModelWithMultipleKeysMock).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.errorFromException).not.toHaveBeenCalled()
  })
  it('retains results while the shared credential version is unchanged', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    expect(result.current.singleModelResult).not.toBeNull()

    rerender()
    expect(result.current.singleModelResult).not.toBeNull()
  })

  it('aborts and clears an active run when the credential draft changes', async () => {
    let signal: AbortSignal | undefined
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, _credentials, _timeout, nextSignal) => {
      signal = nextSignal
      await new Promise<void>(() => undefined)
    })
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    act(() => {
      void result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    await vi.waitFor(() => expect(signal).toBeDefined())

    credentialChangeVersion += 1
    rerender()

    expect(signal?.aborted).toBe(true)
    expect(result.current.isSingleModelChecking).toBe(false)
    expect(result.current.singleModelResult).toBeNull()
  })

  it('aborts an in-flight check when the provider endpoint changes', async () => {
    let endpoint = 'https://open.cherryin.net'
    let capturedSignal: AbortSignal | undefined
    useProviderEndpointsMock.mockImplementation(() => ({ apiHost: endpoint, anthropicApiHost: endpoint }))
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, _credentials, _timeout, signal) => {
      capturedSignal = signal
      await new Promise<void>(() => undefined)
    })
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin', getCredentialsState()))

    act(() => {
      void result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())

    endpoint = 'https://new.cherryin.net'
    rerender()

    expect(capturedSignal?.aborted).toBe(true)
    expect(result.current.isSingleModelChecking).toBe(false)
  })
})
