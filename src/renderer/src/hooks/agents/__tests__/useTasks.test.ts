import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCreateTask, useDeleteTask, useRunTask, useTasks, useUpdateTask } from '../useTasks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
const mockApi = { agent: { runTask: vi.fn() } }
vi.stubGlobal('window', { toast: mockToast, api: mockApi })

describe('useTasks', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('returns empty tasks list when data is undefined', () => {
    MockUseDataApiUtils.mockQueryLoading('/agents/:agentId/tasks')

    const { result } = renderHook(() => useTasks('agent-1'))

    expect(result.current.tasks).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('returns tasks from data.items', () => {
    const mockTasks = [
      { id: 't-1', name: 'Task 1' },
      { id: 't-2', name: 'Task 2' }
    ]
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId/tasks', {
      data: { items: mockTasks, total: 2 } as any
    })

    const { result } = renderHook(() => useTasks('agent-1'))

    expect(result.current.tasks).toEqual(mockTasks)
    expect(result.current.total).toBe(2)
  })
})

describe('useCreateTask', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('calls trigger with correct args and returns result', async () => {
    const newTask = { id: 't-new', name: 'New Task' }
    const mockTrigger = vi.fn().mockResolvedValue(newTask)
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agents/:agentId/tasks', mockTrigger)

    const { result } = renderHook(() => useCreateTask())
    const created = await act(async () => result.current.createTask('agent-1', { name: 'New Task' } as any))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { agentId: 'agent-1' },
      body: { name: 'New Task' }
    })
    expect(created).toEqual(newTask)
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('toasts error and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('create failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agents/:agentId/tasks', mockTrigger)

    const { result } = renderHook(() => useCreateTask())
    const created = await act(async () => result.current.createTask('agent-1', { name: 'Fail' } as any))

    expect(created).toBeUndefined()
    expect(mockToast.error).toHaveBeenCalled()
  })
})

describe('useUpdateTask', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('calls trigger with correct args and returns result', async () => {
    const updatedTask = { id: 't-1', name: 'Updated' }
    const mockTrigger = vi.fn().mockResolvedValue(updatedTask)
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useUpdateTask())
    const updated = await act(async () => result.current.updateTask('agent-1', 't-1', { name: 'Updated' } as any))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { agentId: 'agent-1', taskId: 't-1' },
      body: { name: 'Updated' }
    })
    expect(updated).toEqual(updatedTask)
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('toasts error and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useUpdateTask())
    const updated = await act(async () => result.current.updateTask('agent-1', 't-1', {} as any))

    expect(updated).toBeUndefined()
    expect(mockToast.error).toHaveBeenCalled()
  })
})

describe('useDeleteTask', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('calls trigger and returns true on success', async () => {
    const mockTrigger = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { agentId: 'agent-1', taskId: 't-1' }
    })
    expect(deleted).toBe(true)
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('toasts error and returns false on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('delete failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(deleted).toBe(false)
    expect(mockToast.error).toHaveBeenCalled()
  })
})

describe('useRunTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls window.api.agent.runTask and returns true on success', async () => {
    mockApi.agent.runTask.mockResolvedValue(undefined)

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('agent-1', 't-1'))

    expect(mockApi.agent.runTask).toHaveBeenCalledWith('agent-1', 't-1')
    expect(ran).toBe(true)
    expect(mockToast.success).toHaveBeenCalled()
  })

  it('toasts error and returns false on failure', async () => {
    mockApi.agent.runTask.mockRejectedValue(new Error('run failed'))

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('agent-1', 't-1'))

    expect(ran).toBe(false)
    expect(mockToast.error).toHaveBeenCalled()
  })
})
