import { toast } from '@renderer/services/toast'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { MockUseDataApiUtils, mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCreateTask, useDeleteTask, useRunTask, useSetTaskEnabled, useTasks, useUpdateTask } from '../useTasks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Task commands ride IpcApi (`ai.agent.task.*`); only reads stay on DataApi.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: requestMock,
    on: () => () => {}
  }
}))

const taskEntity = { id: 't-1', agentId: 'agent-1', name: 'Task 1', enabled: true }
const TASK_READ_KEYS = ['/agents/agent-1/tasks', '/agents/agent-1/tasks/*']

// Pin one stable invalidate spy across renders so the read-key assertions
// below can see it (the default mock returns a fresh fn per render).
const invalidateSpy = vi.fn(async () => {})

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
  mockUseInvalidateCache.mockReturnValue(invalidateSpy)
})

describe('useTasks', () => {
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
  it('sends the create command with agentId folded into the input and returns the entity', async () => {
    requestMock.mockResolvedValue(taskEntity)

    const { result } = renderHook(() => useCreateTask())
    const form = { name: 'New Task', workspace: { type: 'system' as const } } as any
    const created = await act(async () => result.current.createTask('agent-1', form))

    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.create', { agentId: 'agent-1', ...form })
    expect(created).toEqual(taskEntity)
    expect(toast.success).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('toasts error and returns undefined on failure', async () => {
    requestMock.mockRejectedValue(new Error('create failed'))

    const { result } = renderHook(() => useCreateTask())
    const created = await act(async () =>
      result.current.createTask('agent-1', { name: 'Fail', workspace: { type: 'system' } } as any)
    )

    expect(created).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('maps AI_AGENT_TASK_TRIGGER_INVALID to the localized form hint', async () => {
    requestMock.mockRejectedValue(new IpcError(aiErrorCodes.AI_AGENT_TASK_TRIGGER_INVALID, 'bad cron'))

    const { result } = renderHook(() => useCreateTask())
    await act(async () => result.current.createTask('agent-1', { name: 'Fail' } as any))

    expect(toast.error).toHaveBeenCalledWith('agent.tasks.error.triggerInvalid')
  })
})

describe('useUpdateTask', () => {
  it('sends the update command with the patch and returns the entity', async () => {
    const updatedTask = { ...taskEntity, name: 'Updated' }
    requestMock.mockResolvedValue(updatedTask)

    const { result } = renderHook(() => useUpdateTask())
    const updated = await act(async () => result.current.updateTask('agent-1', 't-1', { name: 'Updated' }))

    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.update', {
      agentId: 'agent-1',
      taskId: 't-1',
      patch: { name: 'Updated' }
    })
    expect(updated).toEqual(updatedTask)
    expect(toast.success).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('toasts error and returns undefined on failure', async () => {
    requestMock.mockRejectedValue(new Error('update failed'))

    const { result } = renderHook(() => useUpdateTask())
    const updated = await act(async () => result.current.updateTask('agent-1', 't-1', {}))

    expect(updated).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('useSetTaskEnabled', () => {
  it('routes enabled=false to the pause command and enabled=true to resume', async () => {
    requestMock.mockResolvedValue(taskEntity)

    const { result } = renderHook(() => useSetTaskEnabled())
    await act(async () => result.current.setTaskEnabled('agent-1', 't-1', false))
    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.pause', { agentId: 'agent-1', taskId: 't-1' })

    await act(async () => result.current.setTaskEnabled('agent-1', 't-1', true))
    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.resume', { agentId: 'agent-1', taskId: 't-1' })
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('toasts error and returns undefined on failure', async () => {
    requestMock.mockRejectedValue(new Error('pause failed'))

    const { result } = renderHook(() => useSetTaskEnabled())
    const toggled = await act(async () => result.current.setTaskEnabled('agent-1', 't-1', false))

    expect(toggled).toBeUndefined()
    expect(toast.error).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('useDeleteTask', () => {
  it('sends the delete command and returns true on success', async () => {
    requestMock.mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.delete', { agentId: 'agent-1', taskId: 't-1' })
    expect(deleted).toBe(true)
    expect(toast.success).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('toasts error and returns false on failure', async () => {
    requestMock.mockRejectedValue(new Error('delete failed'))

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(deleted).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('useRunTask', () => {
  it('sends the run command with the owning agent id and returns true on success', async () => {
    requestMock.mockResolvedValue(undefined)

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('agent-1', 't-1'))

    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.run', { agentId: 'agent-1', taskId: 't-1' })
    expect(ran).toBe(true)
    expect(toast.success).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('toasts error and returns false on failure', async () => {
    requestMock.mockRejectedValue(new Error('run failed'))

    const { result } = renderHook(() => useRunTask())
    const ran = await act(async () => result.current.runTask('agent-1', 't-1'))

    expect(ran).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
