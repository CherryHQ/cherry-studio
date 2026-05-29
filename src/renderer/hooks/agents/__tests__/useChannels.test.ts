import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChannels } from '../useChannels'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_err: unknown, prefix: string) => prefix
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

const mockToast = {
  success: vi.fn(),
  error: vi.fn()
}
vi.stubGlobal('window', { toast: mockToast })

describe('useChannels', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  describe('channels list', () => {
    it('returns empty array when data is undefined', () => {
      MockUseDataApiUtils.mockQueryLoading('/channels')

      const { result } = renderHook(() => useChannels())

      expect(result.current.channels).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('returns channels from data array', () => {
      const mockChannels = [
        { id: 'ch-1', type: 'telegram', name: 'Bot 1' },
        { id: 'ch-2', type: 'discord', name: 'Bot 2' }
      ]
      MockUseDataApiUtils.mockQueryResult('/channels', {
        data: mockChannels as any
      })

      const { result } = renderHook(() => useChannels())

      expect(result.current.channels).toEqual(mockChannels)
      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('createChannel', () => {
    it('calls the mutation trigger with the provided data', async () => {
      const newChannel = { id: 'ch-new', type: 'telegram', name: 'New Bot' }
      const mockTrigger = vi.fn().mockResolvedValue(newChannel)
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/channels', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const channelData = { type: 'telegram' as const, name: 'New Bot', config: { bot_token: 'tok' }, isActive: true }
      const created = await act(async () => result.current.createChannel(channelData))

      expect(mockTrigger).toHaveBeenCalledWith({ body: channelData })
      expect(created).toEqual(newChannel)
    })

    it('toasts an error and returns null when trigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('create failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/channels', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const created = await act(async () =>
        result.current.createChannel({
          type: 'telegram',
          name: 'New Bot',
          config: { bot_token: 'tok' },
          isActive: true
        })
      )

      expect(created).toBeNull()
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('updateChannel', () => {
    it('calls the mutation trigger with the provided id and updates', async () => {
      const updatedChannel = { id: 'ch-1', type: 'telegram', name: 'Updated Bot' }
      const mockTrigger = vi.fn().mockResolvedValue(updatedChannel)
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/channels/:channelId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const updated = await act(async () => result.current.updateChannel('ch-1', { name: 'Updated Bot' }))

      expect(mockTrigger).toHaveBeenCalledWith({
        params: { channelId: 'ch-1' },
        body: { name: 'Updated Bot' }
      })
      expect(updated).toEqual(updatedChannel)
    })

    it('toasts an error and returns null when trigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('update failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/channels/:channelId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const updated = await act(async () => result.current.updateChannel('ch-1', { name: 'Updated Bot' }))

      expect(updated).toBeNull()
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  describe('deleteChannel', () => {
    it('calls the mutation trigger with the provided id', async () => {
      const mockTrigger = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/channels/:channelId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      await act(async () => result.current.deleteChannel('ch-1'))

      expect(mockTrigger).toHaveBeenCalledWith({ params: { channelId: 'ch-1' } })
    })

    it('toasts an error when trigger throws', async () => {
      const mockTrigger = vi.fn().mockRejectedValue(new Error('delete failed'))
      MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/channels/:channelId', mockTrigger)
      MockUseDataApiUtils.mockQueryResult('/channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      await act(async () => result.current.deleteChannel('ch-1'))

      expect(mockToast.error).toHaveBeenCalled()
    })
  })
})
