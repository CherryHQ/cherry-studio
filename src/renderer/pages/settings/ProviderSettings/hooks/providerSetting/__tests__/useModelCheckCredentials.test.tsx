import type { ApiKeyEntry } from '@shared/data/types/provider'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModelCheckCredentials } from '../useModelCheckCredentials'

const useProviderApiKeysMock = vi.fn()
const useProviderByIdMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const useProviderMetaMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()
const refetchApiKeysMock = vi.fn()

let apiKeyEntries: ApiKeyEntry[]
let hasPendingSync = false
let inputApiKey = 'sk-primary,sk-backup'

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderById: (...args: any[]) => useProviderByIdMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('../useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: () => useAuthenticationApiKeyMock()
}))

vi.mock('../useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

describe('useModelCheckCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiKeyEntries = [
      { id: 'key-1', key: 'sk-primary', label: 'Primary', isEnabled: true },
      { id: 'key-2', key: 'sk-backup', label: 'Backup', isEnabled: true }
    ]
    hasPendingSync = false
    inputApiKey = 'sk-primary,sk-backup'
    useProviderByIdMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
    useProviderApiKeysMock.mockImplementation(() => ({
      data: { keys: apiKeyEntries },
      refetch: refetchApiKeysMock
    }))
    useAuthenticationApiKeyMock.mockImplementation(() => ({
      commitInputApiKeyNow: commitInputApiKeyNowMock,
      hasPendingSync,
      inputApiKey
    }))
    useProviderMetaMock.mockReturnValue({ isApiKeyFieldVisible: true })
    commitInputApiKeyNowMock.mockResolvedValue(undefined)
    refetchApiKeysMock.mockImplementation(async () => ({ keys: apiKeyEntries }))
  })

  it('saves and refetches before resolving the latest selected credential', async () => {
    const refreshedEntry = { id: 'key-2', key: 'sk-refreshed', label: 'Refreshed', isEnabled: true }
    refetchApiKeysMock.mockResolvedValueOnce({ keys: [apiKeyEntries[0], refreshedEntry] })
    const { result } = renderHook(() => useModelCheckCredentials('openai'))

    await expect(
      result.current.prepareCredentials({ mode: 'single', keyId: 'key-2' }, new AbortController().signal)
    ).resolves.toEqual([{ kind: 'api-key', entry: refreshedEntry }])

    expect(commitInputApiKeyNowMock.mock.invocationCallOrder[0]).toBeLessThan(
      refetchApiKeysMock.mock.invocationCallOrder[0]
    )
  })

  it('identifies save failures before stopping credential preparation', async () => {
    const error = new Error('save failed')
    commitInputApiKeyNowMock.mockRejectedValueOnce(error)
    const { result } = renderHook(() => useModelCheckCredentials('openai'))

    await expect(
      result.current.prepareCredentials({ mode: 'all' }, new AbortController().signal)
    ).rejects.toMatchObject({ name: 'ModelCheckCredentialsSaveError', cause: error })
    expect(refetchApiKeysMock).not.toHaveBeenCalled()
  })

  it('accepts the credential refresh caused by its own preparation', async () => {
    let resolveRefetch!: (value: { keys: ApiKeyEntry[] }) => void
    refetchApiKeysMock.mockReturnValueOnce(
      new Promise<{ keys: ApiKeyEntry[] }>((resolve) => {
        resolveRefetch = resolve
      })
    )
    const { result, rerender } = renderHook(() => useModelCheckCredentials('openai'))

    let preparation!: Promise<unknown>
    act(() => {
      preparation = result.current.prepareCredentials({ mode: 'all' }, new AbortController().signal)
    })
    await waitFor(() => expect(refetchApiKeysMock).toHaveBeenCalled())

    apiKeyEntries = apiKeyEntries.map((entry) =>
      entry.id === 'key-1' ? { ...entry, label: 'Saved during preparation' } : entry
    )
    rerender()

    await act(async () => {
      resolveRefetch({ keys: apiKeyEntries })
      await preparation
    })

    expect(result.current.credentialChangeVersion).toBe(0)
  })

  it('keeps enablement changes but invalidates credential identity changes', async () => {
    const { result, rerender } = renderHook(() => useModelCheckCredentials('openai'))

    apiKeyEntries = apiKeyEntries.map((entry, index) => (index === 0 ? { ...entry, isEnabled: false } : entry))
    rerender()
    expect(result.current.credentialChangeVersion).toBe(0)

    apiKeyEntries = apiKeyEntries.map((entry, index) => (index === 0 ? { ...entry, label: 'Renamed' } : entry))
    rerender()
    await waitFor(() => expect(result.current.credentialChangeVersion).toBe(1))
  })

  it('invalidates every pending credential draft edit', async () => {
    const { result, rerender } = renderHook(() => useModelCheckCredentials('openai'))

    hasPendingSync = true
    inputApiKey = 'sk-edited,sk-backup'
    rerender()
    await waitFor(() => expect(result.current.credentialChangeVersion).toBe(1))

    inputApiKey = 'sk-edited-again,sk-backup'
    rerender()
    await waitFor(() => expect(result.current.credentialChangeVersion).toBe(2))
  })
})
