import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HealthStatus, type ModelCheckCredential } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type * as HealthCheckUtils from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
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
