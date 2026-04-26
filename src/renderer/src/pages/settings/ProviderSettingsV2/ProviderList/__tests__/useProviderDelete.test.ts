import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDelete } from '../useProviderDelete'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const deleteProviderByIdMock = vi.fn()
const clearLogoMock = vi.fn()
const onSelectProviderMock = vi.fn()

const providerA = { id: 'openai', name: 'OpenAI' } as any
const providerB = { id: 'anthropic', name: 'Anthropic' } as any

function makeParams(overrides = {}) {
  return {
    deleteProviderById: deleteProviderByIdMock,
    clearLogo: clearLogoMock,
    providers: [providerA, providerB],
    onSelectProvider: onSelectProviderMock,
    ...overrides
  }
}

describe('useProviderDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteProviderByIdMock.mockResolvedValue(undefined)
    clearLogoMock.mockResolvedValue(undefined)
    ;(window as any).modal = { confirm: vi.fn() }
  })

  it('opens a confirmation modal when deleteProvider is called', async () => {
    const { result } = renderHook(() => useProviderDelete(makeParams()))

    await act(async () => {
      await result.current.deleteProvider(providerA)
    })

    expect(window.modal.confirm).toHaveBeenCalledTimes(1)
    const callArgs = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArgs.title).toBe('settings.provider.delete.title')
    expect(callArgs.okText).toBe('common.delete')
  })

  it('clears logo then selects next provider then calls deleteProviderById on confirm', async () => {
    const { result } = renderHook(() => useProviderDelete(makeParams()))

    await act(async () => {
      await result.current.deleteProvider(providerA)
    })

    const { onOk } = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await onOk()
    })

    expect(clearLogoMock).toHaveBeenCalledWith('openai')
    expect(onSelectProviderMock).toHaveBeenCalledWith('anthropic')
    expect(deleteProviderByIdMock).toHaveBeenCalledWith('openai')
  })

  it('selects empty string when deleting the last provider', async () => {
    const { result } = renderHook(() => useProviderDelete(makeParams({ providers: [providerA] })))

    await act(async () => {
      await result.current.deleteProvider(providerA)
    })

    const { onOk } = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await onOk()
    })

    expect(onSelectProviderMock).toHaveBeenCalledWith('')
  })

  it('still calls deleteProviderById even if clearLogo throws', async () => {
    clearLogoMock.mockRejectedValue(new Error('storage error'))
    const { result } = renderHook(() => useProviderDelete(makeParams()))

    await act(async () => {
      await result.current.deleteProvider(providerA)
    })

    const { onOk } = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await act(async () => {
      await onOk()
    })

    expect(deleteProviderByIdMock).toHaveBeenCalledWith('openai')
  })
})
