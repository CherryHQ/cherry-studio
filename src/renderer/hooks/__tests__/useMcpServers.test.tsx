import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMcpServerMutations, useMcpServers } from '../useMcpServers'

describe('useMcpServers', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('strips read-only fields before creating a server', async () => {
    const trigger = vi.fn().mockResolvedValue({ id: 'server-id', name: '@cherry/fetch' })
    MockUseDataApiUtils.mockQueryData('/mcp-servers', { items: [], total: 0, page: 1 })
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/mcp-servers', trigger)

    const { result } = renderHook(() => useMcpServers())

    await act(async () => {
      await result.current.addMcpServer({
        id: '00000000-0000-4000-8000-000000000000',
        name: '@cherry/fetch',
        isActive: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z'
      })
    })

    expect(trigger).toHaveBeenCalledWith({
      body: {
        name: '@cherry/fetch',
        isActive: true
      }
    })
  })

  it('strips read-only fields before updating a server', async () => {
    const trigger = vi.fn().mockResolvedValue({ id: 'server-id', name: '@cherry/fetch' })
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/mcp-servers/server-id', trigger)

    const { result } = renderHook(() => useMcpServerMutations('server-id'))

    await act(async () => {
      await result.current.updateMcpServer({
        body: {
          id: 'server-id',
          name: '@cherry/fetch',
          updatedAt: '2026-06-01T00:00:00.000Z'
        }
      })
    })

    expect(trigger).toHaveBeenCalledWith({
      body: {
        name: '@cherry/fetch'
      }
    })
  })
})
