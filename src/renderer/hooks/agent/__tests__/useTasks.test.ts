import { toast } from '@renderer/services/toast'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAllTasks, useCreateTask, useDeleteTask, useRunTask, useTask, useTasks, useUpdateTask } from '../useTasks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// runTask now goes through ipcApi.request('ai.run_agent_task', taskId).
const { runTaskMock } = vi.hoisted(() => ({ runTaskMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.run_agent_task' ? runTaskMock(input) : Promise.resolve(undefined),
    on: () => () => {}
  }
}))

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

describe('useAllTasks', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('exposes page navigation for the complete task collection', () => {
    const tasks = [{ id: 't-51', name: 'Task 51' }]
    MockUseDataApiUtils.mockPaginatedData('/agent-tasks', tasks, {
      total: 51,
      page: 2,
      hasNext: false,
      hasPrev: true
    })

    const { result } = renderHook(() => useAllTasks())

    expect(result.current.tasks).toEqual(tasks)
    expect(result.current.total).toBe(51)
    expect(result.current.page).toBe(2)
    expect(result.current.pageCount).toBe(2)
    expect(result.current.hasPrev).toBe(true)
  })
})

describe('useTask', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('loads a task independently by id', () => {
    const task = { id: 't-501', name: 'Task 501' }
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', { data: task as any })

    const { result } = renderHook(() => useTask('t-501'))

    expect(result.current.task).toEqual(task)
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
    const taskData = { name: 'New Task', workspace: { type: 'system' as const } } as any
    const created = await act(async () => result.current.createTask('agent-1', taskData))

    expect(mockTrigger).toHaveBeenCalledWith({
      params: { agentId: 'agent-1' },
      body: taskData
    })
    expect(created).toEqual(newTask)
    expect(toast.success).toHaveBeenCalled()
  })

  it('toasts error and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('create failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('POST', '/agents/:agentId/tasks', mockTrigger)

    const { result } = renderHook(() => useCreateTask())
    const created = await act(async () =>
      result.current.createTask('agent-1', { name: 'Fail', workspace: { type: 'system' } } as any)
    )

    expect(created).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
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
    expect(toast.success).toHaveBeenCalled()
  })

  it('toasts error and returns undefined on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('update failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useUpdateTask())
    const updated = await act(async () => result.current.updateTask('agent-1', 't-1', {} as any))

    expect(updated).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
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
    expect(toast.success).toHaveBeenCalled()
  })

  it('toasts error and returns false on failure', async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error('delete failed'))
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agents/:agentId/tasks/:taskId', mockTrigger)

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(deleted).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('useRunTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the ai.run_agent_task route and returns true on success', async () => {
    runTaskMock.mockResolvedValue(undefined)

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('t-1'))

    expect(runTaskMock).toHaveBeenCalledWith('t-1')
    expect(ran).toBe(true)
    expect(toast.success).toHaveBeenCalled()
  })

  it('toasts error and returns false on failure', async () => {
    runTaskMock.mockRejectedValue(new Error('run failed'))

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('t-1'))

    expect(ran).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })
})
