import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEditor } from '../useProviderEditor'

const uuidMock = vi.fn().mockReturnValue('new-provider-id')

vi.mock('@renderer/utils', () => ({
  uuid: () => uuidMock()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const saveLogoMock = vi.fn()
const clearLogoMock = vi.fn()
const onSelectProviderMock = vi.fn()

function makeParams(overrides = {}) {
  return {
    createProvider: createProviderMock,
    updateProviderById: updateProviderByIdMock,
    saveLogo: saveLogoMock,
    clearLogo: clearLogoMock,
    onSelectProvider: onSelectProviderMock,
    ...overrides
  }
}

const provider = { id: 'openai', name: 'OpenAI' } as any
const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS

describe('useProviderEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createProviderMock.mockResolvedValue({ id: 'new-provider-id', name: 'My Provider' })
    updateProviderByIdMock.mockResolvedValue(undefined)
    saveLogoMock.mockResolvedValue(undefined)
    clearLogoMock.mockResolvedValue(undefined)
    ;(window as any).toast = { error: vi.fn() }
  })

  describe('initial state', () => {
    it('starts closed with no editing provider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      expect(result.current.isOpen).toBe(false)
      expect(result.current.editingProvider).toBeNull()
    })
  })

  describe('state transitions', () => {
    it('startAdd opens the editor in add mode', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())

      expect(result.current.isOpen).toBe(true)
      expect(result.current.editingProvider).toBeNull()
    })

    it('startEdit opens the editor in edit mode with the given provider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))

      expect(result.current.isOpen).toBe(true)
      expect(result.current.editingProvider).toBe(provider)
    })

    it('startAdd clears editingProvider when switching from edit mode', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      act(() => result.current.startAdd())

      expect(result.current.editingProvider).toBeNull()
    })

    it('cancel closes the editor and clears editingProvider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      act(() => result.current.cancel())

      expect(result.current.isOpen).toBe(false)
      expect(result.current.editingProvider).toBeNull()
    })
  })

  describe('submit — create path', () => {
    it('calls createProvider with a new uuid, then onSelectProvider and closes', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({ name: 'My Provider', defaultChatEndpoint: endpoint })
      })

      expect(createProviderMock).toHaveBeenCalledWith({
        providerId: 'new-provider-id',
        name: 'My Provider',
        defaultChatEndpoint: endpoint
      })
      expect(onSelectProviderMock).toHaveBeenCalledWith('new-provider-id')
      expect(result.current.isOpen).toBe(false)
    })

    it('saves logo after create when logo is provided', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({
          name: 'My Provider',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,abc'
        })
      })

      expect(saveLogoMock).toHaveBeenCalledWith('new-provider-id', 'data:image/png;base64,abc')
    })

    it('skips saveLogo when logo is not provided', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({ name: 'My Provider', defaultChatEndpoint: endpoint })
      })

      expect(saveLogoMock).not.toHaveBeenCalled()
    })

    it('shows error toast when saveLogo fails on create', async () => {
      saveLogoMock.mockRejectedValue(new Error('storage full'))
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({
          name: 'My Provider',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,abc'
        })
      })

      expect(window.toast.error).toHaveBeenCalledWith('message.error.save_provider_logo')
    })

    it('does nothing when name is empty', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({ name: '   ', defaultChatEndpoint: endpoint })
      })

      expect(createProviderMock).not.toHaveBeenCalled()
      expect(result.current.isOpen).toBe(true)
    })
  })

  describe('submit — update path', () => {
    it('calls updateProviderById and closes the editor', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint })
      })

      expect(updateProviderByIdMock).toHaveBeenCalledWith('openai', {
        name: 'Renamed',
        defaultChatEndpoint: endpoint
      })
      expect(createProviderMock).not.toHaveBeenCalled()
      expect(result.current.isOpen).toBe(false)
    })

    it('saves logo when logo is provided on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({
          name: 'Renamed',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,new'
        })
      })

      expect(saveLogoMock).toHaveBeenCalledWith('openai', 'data:image/png;base64,new')
    })

    it('clears logo when logo is null on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint, logo: null })
      })

      expect(clearLogoMock).toHaveBeenCalledWith('openai')
      expect(saveLogoMock).not.toHaveBeenCalled()
    })

    it('skips logo mutation when logo is undefined on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint })
      })

      expect(saveLogoMock).not.toHaveBeenCalled()
      expect(clearLogoMock).not.toHaveBeenCalled()
    })

    it('shows error toast when saveLogo fails on update', async () => {
      saveLogoMock.mockRejectedValue(new Error('storage full'))
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({
          name: 'Renamed',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,new'
        })
      })

      expect(window.toast.error).toHaveBeenCalledWith('message.error.update_provider_logo')
    })

    it('does not call onSelectProvider on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint })
      })

      expect(onSelectProviderMock).not.toHaveBeenCalled()
    })
  })
})
