import { useQuery } from '@data/hooks/useDataApi'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgent } from '../useAgent'

describe('useAgent', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('does not fetch when id is null', () => {
    const mockUseQuery = vi.mocked(useQuery)
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn() as any
    })

    const { result } = renderHook(() => useAgent(null))

    expect(result.current.agent).toBeUndefined()
    // useQuery should be called with enabled: false
    expect(mockUseQuery).toHaveBeenCalledWith('/agents/:agentId', expect.objectContaining({ enabled: false }))
  })

  it('fetches agent when id is provided', () => {
    const mockAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      model: 'claude-3',
      type: 'claude-code',
      accessiblePaths: [],
      allowedTools: [],
      configuration: { permission_mode: 'default', max_turns: 100, env_vars: {} },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    vi.mocked(useQuery).mockReturnValue({
      data: mockAgent as any,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn() as any
    })

    const { result } = renderHook(() => useAgent('agent-1'))

    expect(result.current.agent).toBeDefined()
    expect(result.current.agent?.id).toBe('agent-1')
    expect(result.current.isLoading).toBe(false)
  })

  it('applies configuration defaults when configuration has raw values', () => {
    const mockAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      model: 'claude-3',
      type: 'claude-code',
      accessiblePaths: [],
      allowedTools: [],
      // Raw configuration from DataAPI — no defaults applied
      configuration: { avatar: '🤖' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
    vi.mocked(useQuery).mockReturnValue({
      data: mockAgent as any,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn() as any
    })

    const { result } = renderHook(() => useAgent('agent-1'))

    // Zod defaults should be applied
    expect(result.current.agent?.configuration?.permission_mode).toBe('default')
    expect(result.current.agent?.configuration?.max_turns).toBe(100)
    expect(result.current.agent?.configuration?.env_vars).toEqual({})
  })

  it('returns loading state correctly', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn() as any
    })

    const { result } = renderHook(() => useAgent('agent-1'))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.agent).toBeUndefined()
  })

  it('exposes refetch as revalidate', () => {
    const mockRefetch = vi.fn()
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: mockRefetch,
      mutate: vi.fn() as any
    })

    const { result } = renderHook(() => useAgent('agent-1'))

    result.current.revalidate()
    expect(mockRefetch).toHaveBeenCalled()
  })
})
