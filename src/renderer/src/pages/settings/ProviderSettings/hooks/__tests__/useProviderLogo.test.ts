import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearProviderLogo, removeProviderLogo, saveProviderLogo, useProviderLogo } from '../useProviderLogo'

const getMock = vi.fn()
const setMock = vi.fn()
const removeMock = vi.fn()

vi.mock('@renderer/services/ImageStorage', () => ({
  default: {
    get: (...args: any[]) => getMock(...args),
    set: (...args: any[]) => setMock(...args),
    remove: (...args: any[]) => removeMock(...args)
  }
}))

describe('useProviderLogo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue('')
    setMock.mockResolvedValue(undefined)
    removeMock.mockResolvedValue(undefined)
  })

  it('loads one provider logo from storage', async () => {
    getMock.mockResolvedValue('icon:openai')

    const { result } = renderHook(() => useProviderLogo('openai'))

    await waitFor(() => expect(result.current.logo).toBe('icon:openai'))

    expect(getMock).toHaveBeenCalledWith('provider-openai')
  })

  it('updates subscribed readers after save, clear, and remove', async () => {
    getMock.mockResolvedValueOnce('logo-openai')

    const { result } = renderHook(() => useProviderLogo('anthropic'))

    await waitFor(() => expect(result.current.logo).toBe('logo-openai'))

    await act(async () => {
      await saveProviderLogo('anthropic', 'logo-updated')
    })

    expect(setMock).toHaveBeenCalledWith('provider-anthropic', 'logo-updated')
    await waitFor(() => expect(result.current.logo).toBe('logo-updated'))

    await act(async () => {
      await clearProviderLogo('anthropic')
    })

    expect(setMock).toHaveBeenCalledWith('provider-anthropic', '')
    await waitFor(() => expect(result.current.logo).toBeUndefined())

    await act(async () => {
      await saveProviderLogo('anthropic', 'logo-restored')
    })

    await waitFor(() => expect(result.current.logo).toBe('logo-restored'))

    await act(async () => {
      await removeProviderLogo('anthropic')
    })

    expect(removeMock).toHaveBeenCalledWith('provider-anthropic')
    await waitFor(() => expect(result.current.logo).toBeUndefined())
  })

  it('returns undefined when providerId is missing', () => {
    const { result } = renderHook(() => useProviderLogo(undefined))

    expect(result.current.logo).toBeUndefined()
    expect(getMock).not.toHaveBeenCalled()
  })
})
