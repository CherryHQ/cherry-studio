import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEditor } from '../useProviderEditor'

const uuidMock = vi.fn().mockReturnValue('new-provider-id')

vi.mock('@renderer/utils', () => ({
  uuid: () => uuidMock()
}))

const useProvidersMock = vi.fn()
const useProviderActionsMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: (...args: any[]) => useProvidersMock(...args),
  useProviderActions: (...args: any[]) => useProviderActionsMock(...args)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const useProviderLogoMock = vi.fn()
const saveProviderLogoMock = vi.fn()
const clearProviderLogoMock = vi.fn()

vi.mock('../../hooks/useProviderLogo', () => ({
  useProviderLogo: (...args: any[]) => useProviderLogoMock(...args),
  saveProviderLogo: (...args: any[]) => saveProviderLogoMock(...args),
  clearProviderLogo: (...args: any[]) => clearProviderLogoMock(...args)
}))

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const onProviderCreatedMock = vi.fn()

function makeParams(overrides = {}) {
  return {
    onProviderCreated: onProviderCreatedMock,
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
    saveProviderLogoMock.mockResolvedValue(undefined)
    clearProviderLogoMock.mockResolvedValue(undefined)
    useProvidersMock.mockReturnValue({
      createProvider: createProviderMock
    })
    useProviderActionsMock.mockReturnValue({
      updateProviderById: updateProviderByIdMock
    })
    useProviderLogoMock.mockReturnValue({ logo: undefined })
  })

  describe('initial state', () => {
    it('starts closed with no editing provider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      expect(result.current.isOpen).toBe(false)
      expect(result.current.editingProvider).toBeNull()
      expect(result.current.initialLogo).toBeUndefined()
    })
  })

  describe('state transitions', () => {
    it('startAdd opens the editor in create-custom mode', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())

      expect(result.current.isOpen).toBe(true)
      expect(result.current.editingProvider).toBeNull()
      expect(result.current.mode).toEqual({ kind: 'create-custom' })
    })

    it('startAddFrom opens the editor in duplicate mode with the source provider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      const source = { ...provider, presetProviderId: 'openai', authType: 'api-key' } as any

      act(() => result.current.startAddFrom(source))

      expect(result.current.isOpen).toBe(true)
      expect(result.current.editingProvider).toBeNull()
      expect(result.current.mode).toEqual({ kind: 'duplicate', source })
    })

    it('startEdit opens the editor in edit mode with the given provider', () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))

      expect(result.current.isOpen).toBe(true)
      expect(result.current.editingProvider).toBe(provider)
    })

    it('exposes the persisted logo for the editing provider', () => {
      useProviderLogoMock.mockReturnValue({ logo: 'icon:openai' })
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))

      expect(result.current.initialLogo).toBe('icon:openai')
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
    it('calls createProvider with a new uuid, then onProviderCreated and closes', async () => {
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
      expect(onProviderCreatedMock).toHaveBeenCalledWith('new-provider-id')
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

      expect(saveProviderLogoMock).toHaveBeenCalledWith('new-provider-id', 'data:image/png;base64,abc')
    })

    it('skips saveProviderLogo when logo is not provided', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({ name: 'My Provider', defaultChatEndpoint: endpoint })
      })

      expect(saveProviderLogoMock).not.toHaveBeenCalled()
    })

    it('returns a notice when saveProviderLogo fails on create', async () => {
      saveProviderLogoMock.mockRejectedValue(new Error('storage full'))
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      let submitResult: Awaited<ReturnType<typeof result.current.submit>> | undefined

      act(() => result.current.startAdd())
      await act(async () => {
        submitResult = await result.current.submit({
          name: 'My Provider',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,abc'
        })
      })

      expect(submitResult).toEqual({ notice: 'create-logo-save-failed' })
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

    it('forwards endpointConfigs and authConfig to createProvider', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startAdd())
      await act(async () => {
        await result.current.submit({
          name: 'Custom OpenAI Proxy',
          defaultChatEndpoint: endpoint,
          endpointConfigs: { [endpoint]: { baseUrl: 'https://proxy.example.com' } },
          authConfig: { type: 'api-key' }
        })
      })

      expect(createProviderMock).toHaveBeenCalledWith({
        providerId: 'new-provider-id',
        name: 'Custom OpenAI Proxy',
        defaultChatEndpoint: endpoint,
        endpointConfigs: { [endpoint]: { baseUrl: 'https://proxy.example.com' } },
        authConfig: { type: 'api-key' }
      })
    })

    it('forwards presetProviderId on duplicate-mode submit', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      const source = { ...provider, presetProviderId: 'azure-openai', authType: 'iam-azure' } as any

      act(() => result.current.startAddFrom(source))
      await act(async () => {
        await result.current.submit({
          name: 'azure-2',
          defaultChatEndpoint: endpoint,
          presetProviderId: 'azure-openai',
          authConfig: { type: 'iam-azure', apiVersion: '' }
        })
      })

      expect(createProviderMock).toHaveBeenCalledWith({
        providerId: 'new-provider-id',
        name: 'azure-2',
        defaultChatEndpoint: endpoint,
        presetProviderId: 'azure-openai',
        authConfig: { type: 'iam-azure', apiVersion: '' }
      })
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

      expect(saveProviderLogoMock).toHaveBeenCalledWith('openai', 'data:image/png;base64,new')
    })

    it('clears logo when logo is null on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint, logo: null })
      })

      expect(clearProviderLogoMock).toHaveBeenCalledWith('openai')
      expect(saveProviderLogoMock).not.toHaveBeenCalled()
    })

    it('skips logo mutation when logo is undefined on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint })
      })

      expect(saveProviderLogoMock).not.toHaveBeenCalled()
      expect(clearProviderLogoMock).not.toHaveBeenCalled()
    })

    it('returns a notice when saveProviderLogo fails on update', async () => {
      saveProviderLogoMock.mockRejectedValue(new Error('storage full'))
      const { result } = renderHook(() => useProviderEditor(makeParams()))
      let submitResult: Awaited<ReturnType<typeof result.current.submit>> | undefined

      act(() => result.current.startEdit(provider))
      await act(async () => {
        submitResult = await result.current.submit({
          name: 'Renamed',
          defaultChatEndpoint: endpoint,
          logo: 'data:image/png;base64,new'
        })
      })

      expect(submitResult).toEqual({ notice: 'update-logo-save-failed' })
    })

    it('does not call onProviderCreated on update', async () => {
      const { result } = renderHook(() => useProviderEditor(makeParams()))

      act(() => result.current.startEdit(provider))
      await act(async () => {
        await result.current.submit({ name: 'Renamed', defaultChatEndpoint: endpoint })
      })

      expect(onProviderCreatedMock).not.toHaveBeenCalled()
    })
  })
})
