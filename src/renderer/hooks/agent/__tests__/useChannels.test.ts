import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import { useChannels } from '../useChannels'

const ipcRequest = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

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

describe('useChannels', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
    ipcRequest.mockReset()
  })

  describe('channels list', () => {
    it('returns empty array when data is undefined', () => {
      MockUseDataApiUtils.mockQueryLoading('/agent-channels')

      const { result } = renderHook(() => useChannels())

      expect(result.current.channels).toEqual([])
      expect(result.current.isLoading).toBe(true)
    })

    it('returns channels from data array', () => {
      const mockChannels = [
        { id: 'ch-1', type: 'telegram', name: 'Bot 1' },
        { id: 'ch-2', type: 'discord', name: 'Bot 2' }
      ]
      MockUseDataApiUtils.mockQueryResult('/agent-channels', {
        data: mockChannels as any
      })

      const { result } = renderHook(() => useChannels())

      expect(result.current.channels).toEqual(mockChannels)
      expect(result.current.isLoading).toBe(false)
    })

    it('refetches channels when another window publishes a channel projection change', () => {
      const refetch = vi.fn().mockResolvedValue(undefined)
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [], refetch })
      renderHook(() => useChannels())

      act(() => {
        MockUseDataApiUtils.emitDataChange([
          { endpoint: '/agent-channels', kind: 'projection', entityIds: ['channel-detached'] }
        ])
      })

      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('createChannel', () => {
    it('sends channel creation through IpcApi', async () => {
      const newChannel = { id: 'ch-new', type: 'telegram', name: 'New Bot' }
      ipcRequest.mockResolvedValue(newChannel)
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const channelData = {
        type: 'telegram' as const,
        name: 'New Bot',
        workspace: { type: 'system' as const },
        config: { bot_token: 'tok' },
        isActive: true
      }
      const created = await act(async () => result.current.createChannel(channelData))

      expect(ipcRequest).toHaveBeenCalledWith('channel.create', channelData)
      expect(created).toEqual(newChannel)
    })

    it('toasts an error and returns null when trigger throws', async () => {
      ipcRequest.mockRejectedValue(new Error('create failed'))
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const created = await act(async () =>
        result.current.createChannel({
          type: 'telegram',
          name: 'New Bot',
          workspace: { type: 'system' },
          config: { bot_token: 'tok' },
          isActive: true
        })
      )

      expect(created).toBeNull()
      expect(toast.error).toHaveBeenCalled()
    })
  })

  describe('updateChannel', () => {
    it('sends channel updates through IpcApi', async () => {
      const updatedChannel = { id: 'ch-1', type: 'telegram', name: 'Updated Bot' }
      ipcRequest.mockResolvedValue(updatedChannel)
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const updated = await act(async () => result.current.updateChannel('ch-1', { name: 'Updated Bot' }))

      expect(ipcRequest).toHaveBeenCalledWith('channel.update', {
        channelId: 'ch-1',
        updates: { name: 'Updated Bot' }
      })
      expect(updated).toEqual(updatedChannel)
    })

    it('toasts an error and returns null when trigger throws', async () => {
      ipcRequest.mockRejectedValue(new Error('update failed'))
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      const updated = await act(async () => result.current.updateChannel('ch-1', { name: 'Updated Bot' }))

      expect(updated).toBeNull()
      expect(toast.error).toHaveBeenCalled()
    })
  })

  describe('deleteChannel', () => {
    it('sends channel deletion through IpcApi', async () => {
      ipcRequest.mockResolvedValue(undefined)
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      await act(async () => result.current.deleteChannel('ch-1'))

      expect(ipcRequest).toHaveBeenCalledWith('channel.delete', { channelId: 'ch-1' })
    })

    it('toasts an error when trigger throws', async () => {
      ipcRequest.mockRejectedValue(new Error('delete failed'))
      MockUseDataApiUtils.mockQueryResult('/agent-channels', { data: [] as any })

      const { result } = renderHook(() => useChannels())
      await act(async () => result.current.deleteChannel('ch-1'))

      expect(toast.error).toHaveBeenCalled()
    })
  })
})
