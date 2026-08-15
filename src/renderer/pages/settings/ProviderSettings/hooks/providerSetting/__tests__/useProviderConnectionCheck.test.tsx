import { HealthStatus, type ModelCheckCredential } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type * as HealthCheckUtils from '@renderer/pages/settings/ProviderSettings/utils/healthCheck'
import { toast } from '@renderer/services/toast'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderConnectionCheck } from '../useProviderConnectionCheck'

const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useModelsMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const useProviderMetaMock = vi.fn()
const checkModelWithMultipleKeysMock = vi.fn()
const enableProviderMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()
const refetchApiKeysMock = vi.fn()

let inputApiKey = 'sk-primary,sk-backup'
let apiKeyEntries: ApiKeyEntry[]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { t: (key: string) => key }
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('../useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

vi.mock('../useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
}))

vi.mock('../useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
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
  beforeEach(() => {
    vi.clearAllMocks()
    inputApiKey = 'sk-primary,sk-backup'
    apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-backup', label: 'Backup', isEnabled: true }
    ]

    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useModelsMock.mockReturnValue({ models: [model] })
    useProviderApiKeysMock.mockImplementation(() => ({
      data: { keys: apiKeyEntries },
      refetch: refetchApiKeysMock
    }))
    refetchApiKeysMock.mockImplementation(async () => ({ keys: apiKeyEntries }))
    commitInputApiKeyNowMock.mockResolvedValue(undefined)
    useAuthenticationApiKeyMock.mockImplementation(() => ({
      inputApiKey,
      commitInputApiKeyNow: commitInputApiKeyNowMock
    }))
    useProviderEndpointsMock.mockReturnValue({
      apiHost: 'https://open.cherryin.net',
      anthropicApiHost: 'https://open.cherryin.net'
    })
    useProviderMetaMock.mockReturnValue({ isApiKeyFieldVisible: true })
  })

  it('saves and refetches before checking all enabled API keys concurrently', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials) =>
      credentials.map((credential: ModelCheckCredential) => successfulResult(credential))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(outcome).toBe('passed')
    expect(commitInputApiKeyNowMock.mock.invocationCallOrder[0]).toBeLessThan(
      refetchApiKeysMock.mock.invocationCallOrder[0]
    )
    expect(refetchApiKeysMock.mock.invocationCallOrder[0]).toBeLessThan(
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

  it('accepts the credential refresh caused by its own preflight save', async () => {
    let resolveRefetch!: (value: { keys: ApiKeyEntry[] }) => void
    refetchApiKeysMock.mockReturnValueOnce(
      new Promise<{ keys: ApiKeyEntry[] }>((resolve) => {
        resolveRefetch = resolve
      })
    )
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin'))

    let checkTask!: Promise<'passed' | 'failed'>
    act(() => {
      checkTask = result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    await waitFor(() => expect(refetchApiKeysMock).toHaveBeenCalled())

    apiKeyEntries = apiKeyEntries.map((entry) =>
      entry.id === 'key-1' ? { ...entry, label: 'Saved during preflight' } : entry
    )
    rerender()

    await act(async () => {
      resolveRefetch({ keys: apiKeyEntries })
      await expect(checkTask).resolves.toBe('passed')
    })

    expect(checkModelWithMultipleKeysMock).toHaveBeenCalledTimes(1)
    expect(result.current.singleModelResult?.kind).toBe('ok')
  })

  it('keeps the complete per-key report when any API key fails', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) => [
      successfulResult(credentials[0]),
      failedResult(credentials[1], 'Quota exceeded')
    ])
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

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
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(enableProviderMock).not.toHaveBeenCalled()
    expect(result.current.singleModelResult?.kind).toBe('failed')
  })

  it('stops before probing when the pending API key cannot be saved', async () => {
    commitInputApiKeyNowMock.mockRejectedValueOnce(new Error('save failed'))
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(outcome).toBe('failed')
    expect(refetchApiKeysMock).not.toHaveBeenCalled()
    expect(checkModelWithMultipleKeysMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.provider.api_key.save_failed' })
    )
  })

  it('checks keyless providers through provider authentication', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama', isEnabled: false, authOptional: true },
      enableProvider: enableProviderMock
    })
    useProviderMetaMock.mockReturnValue({ isApiKeyFieldVisible: true })
    inputApiKey = ''
    apiKeyEntries = []
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) => [
      successfulResult(credentials[0])
    ])
    const { result } = renderHook(() => useProviderConnectionCheck('ollama'))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(result.current.canSelectApiKey).toBe(true)
    expect(result.current.requiresApiKey).toBe(false)
    expect(checkModelWithMultipleKeysMock).toHaveBeenCalledWith(
      model,
      [{ kind: 'provider-auth', id: 'provider-auth', key: '' }],
      15000,
      expect.any(AbortSignal)
    )
  })

  it('checks explicit API keys when provider authentication is optional', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'optional-provider',
        name: 'Optional Provider',
        isEnabled: false,
        authMethods: ['api-key'],
        authOptional: true
      },
      enableProvider: enableProviderMock
    })
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    const { result } = renderHook(() => useProviderConnectionCheck('optional-provider'))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })

    expect(result.current.canSelectApiKey).toBe(true)
    expect(result.current.requiresApiKey).toBe(false)
    expect(checkModelWithMultipleKeysMock).toHaveBeenCalledWith(
      model,
      [
        { kind: 'api-key', entry: apiKeyEntries[0] },
        { kind: 'api-key', entry: apiKeyEntries[1] }
      ],
      15000,
      expect.any(AbortSignal)
    )
  })

  it('retains results across enable toggles but clears them when credential content changes', async () => {
    checkModelWithMultipleKeysMock.mockImplementation(async (_model, credentials: ModelCheckCredential[]) =>
      credentials.map((credential) => successfulResult(credential))
    )
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startSingleModelCheck({ model, keySelection: { mode: 'all' } })
    })
    expect(result.current.singleModelResult).not.toBeNull()

    apiKeyEntries = apiKeyEntries.map((entry, index) => (index === 0 ? { ...entry, isEnabled: false } : entry))
    rerender()
    expect(result.current.singleModelResult).not.toBeNull()

    apiKeyEntries = apiKeyEntries.map((entry, index) => (index === 0 ? { ...entry, label: 'Renamed' } : entry))
    rerender()
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
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin'))

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
