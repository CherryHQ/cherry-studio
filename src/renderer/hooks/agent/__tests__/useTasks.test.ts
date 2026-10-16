import { MockUseDataApiUtils, mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { useTaskDashboardViewing } from '../useTaskDashboardViewing'
import {
  TASKS_PAGE_LIMIT,
  useAllTasks,
  useCreateTask,
  useDeleteTask,
  useRunTask,
  useSetTaskEnabled,
  useTask,
  useTaskLogs,
  useTasks,
  useUpdateTask
} from '../useTasks'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// Task commands ride IpcApi (`ai.agent.task.*`); only reads stay on DataApi.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
const viewing = vi.hoisted(() => ({
  tab: { id: 'tab', type: 'route' as const, url: '/app/agents?sessionId=one', title: 'One' },
  events: new Map<string, () => void>()
}))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ activeTab: viewing.tab }) }))
vi.mock('@renderer/ipc', () => ({
  useIpcOn: (event: string, listener: () => void) => viewing.events.set(event, listener),
  ipcApi: {
    request: requestMock,
    on: () => () => {}
  }
}))

describe('task dashboard viewing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    viewing.tab = { id: 'tab', type: 'route', url: '/app/agents?sessionId=one', title: 'One' }
    viewing.events.clear()
    requestMock.mockResolvedValue(undefined)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const change = async () => {
    act(() => MockUseDataApiUtils.emitDataChange([{ endpoint: '/agent-task-dashboard', kind: 'membership' }]))
    await act(() => vi.advanceTimersByTimeAsync(250))
  }
  const select = (url = viewing.tab.url) =>
    act(() => EventEmitter.emit(EVENT_NAMES.ACTIVE_TAB_SELECTED, { tabId: 'tab', url }))

  it('does not review restored tabs, then automatically reviews completions only after an explicit selection', async () => {
    renderHook(() => useTaskDashboardViewing())
    await change()
    expect(requestMock).not.toHaveBeenCalled()
    await select()
    expect(requestMock).toHaveBeenLastCalledWith('ai.agent.task_dashboard.view_session', {
      sessionId: 'one',
      automatic: false
    })
    await change()
    expect(requestMock).toHaveBeenLastCalledWith('ai.agent.task_dashboard.view_session', {
      sessionId: 'one',
      automatic: true
    })
    requestMock.mockClear()
    fireEvent.click(document.body)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('waits for the selected session rather than reviewing the previous visible tab', async () => {
    const { rerender } = renderHook(() => useTaskDashboardViewing())
    await select('/app/agents?sessionId=two')
    expect(requestMock).not.toHaveBeenCalled()
    viewing.tab = { ...viewing.tab, url: '/app/agents?sessionId=two&forkReturnSessionId=one' }
    rerender()
    expect(requestMock).toHaveBeenLastCalledWith('ai.agent.task_dashboard.view_session', {
      sessionId: 'two',
      automatic: false
    })
    requestMock.mockClear()
    viewing.tab = { ...viewing.tab, url: '/app/agents?sessionId=one' }
    rerender()
    await change()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('drops viewing on blur, hidden windows and power reset, and requires focus regain after reset', async () => {
    renderHook(() => useTaskDashboardViewing())
    await select()
    requestMock.mockClear()
    fireEvent(window, new Event('blur'))
    await change()
    expect(requestMock).not.toHaveBeenCalled()
    fireEvent(window, new Event('focus'))
    expect(requestMock).toHaveBeenLastCalledWith('ai.agent.task_dashboard.view_session', {
      sessionId: 'one',
      automatic: false
    })
    requestMock.mockClear()
    act(() => viewing.events.get('ai.agent.task_dashboard.attention_reset')?.())
    fireEvent(window, new Event('focus'))
    await change()
    expect(requestMock).not.toHaveBeenCalled()
    vi.mocked(document.hasFocus).mockReturnValue(false)
    await select()
    await change()
    expect(requestMock).not.toHaveBeenCalled()
    vi.mocked(document.hasFocus).mockReturnValue(true)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await select()
    await change()
    expect(requestMock).not.toHaveBeenCalled()
  })
})

const taskEntity = { id: 't-1', agentId: 'agent-1', name: 'Task 1', enabled: true }
const TASK_LIST_READ_KEYS = ['/agent-tasks', '/agents/agent-1/tasks']
const TASK_READ_KEYS = ['/agent-tasks', '/agent-tasks/*', '/agents/agent-1/tasks', '/agents/agent-1/tasks/*']

// Pin one stable invalidate spy across renders so the read-key assertions
// below can see it (the default mock returns a fresh fn per render).
const invalidateSpy = vi.fn(async () => {})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
  mockUseInvalidateCache.mockReturnValue(invalidateSpy)
  vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
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

describe('useAllTasks', () => {
  it('returns the cross-agent paginated task list and page count', () => {
    MockUseDataApiUtils.mockPaginatedData('/agent-tasks', [taskEntity], {
      total: TASKS_PAGE_LIMIT + 1,
      page: 2,
      hasPrev: true
    })

    const { result } = renderHook(() => useAllTasks())

    expect(result.current.tasks).toEqual([taskEntity])
    expect(result.current.total).toBe(TASKS_PAGE_LIMIT + 1)
    expect(result.current.page).toBe(2)
    expect(result.current.pageCount).toBe(2)
    expect(result.current.hasPrev).toBe(true)
  })

  it('refetches task projections published by a background sticky-session bind', () => {
    MockUseDataApiUtils.mockPaginatedData('/agent-tasks', [taskEntity])
    const { result } = renderHook(() => useAllTasks())

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/agent-tasks', kind: 'projection' as const, entityIds: ['t-1'] }])

    expect(result.current.refetch).toHaveBeenCalled()
  })
})

describe('useTask', () => {
  it('reads one task without requiring its owning agent id', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', { data: taskEntity as any })

    const { result } = renderHook(() => useTask('t-1'))

    expect(result.current.task).toEqual(taskEntity)
    expect(result.current.isLoading).toBe(false)
  })

  it('refetches the matching task detail after a sticky-session pointer change', () => {
    const refetch = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', { data: taskEntity as any, refetch })
    renderHook(() => useTask('t-1'))

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/agent-tasks/:taskId', entityIds: ['t-1'] }])

    expect(refetch).toHaveBeenCalled()
  })
})

describe('useTaskLogs', () => {
  it('refetches the run history when a run of the viewed task changes state', () => {
    const refetch = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/agents/:agentId/tasks/:taskId/logs', {
      data: { items: [], total: 0, page: 1 } as any,
      refetch
    })
    renderHook(() => useTaskLogs('agent-1', 't-1'))

    MockUseDataApiUtils.emitDataChange([
      {
        endpoint: '/agents/:agentId/tasks/:taskId/logs',
        kind: 'projection',
        routeParams: { taskId: 't-1' },
        entityIds: ['job-1']
      }
    ])

    expect(refetch).toHaveBeenCalled()
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
    const navigation = createDeferred<void>()
    requestMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn(() => navigation.promise)

    const { result } = renderHook(() => useDeleteTask())
    const deletion = result.current.deleteTask('agent-1', 't-1', { onDeleted })

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(invalidateSpy).not.toHaveBeenCalled()

    navigation.resolve()
    const deleted = await act(async () => deletion)

    expect(requestMock).toHaveBeenCalledWith('ai.agent.task.delete', { agentId: 'agent-1', taskId: 't-1' })
    expect(deleted).toBe(true)
    expect(toast.success).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_READ_KEYS)
  })

  it('preserves a successful deletion when post-delete navigation fails', async () => {
    const navigation = createDeferred<void>()
    requestMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn(() => navigation.promise)

    const { result } = renderHook(() => useDeleteTask())
    const deletion = result.current.deleteTask('agent-1', 't-1', { onDeleted })

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(invalidateSpy).not.toHaveBeenCalled()

    navigation.reject(new Error('navigation failed'))
    const deleted = await act(async () => deletion)

    expect(deleted).toBe(true)
    expect(invalidateSpy).toHaveBeenCalledWith(TASK_LIST_READ_KEYS)
    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('preserves a successful deletion when refreshing task data fails', async () => {
    requestMock.mockResolvedValue(undefined)
    invalidateSpy.mockRejectedValueOnce(new Error('refresh failed'))

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1'))

    expect(deleted).toBe(true)
    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts error and returns false on failure', async () => {
    requestMock.mockRejectedValue(new Error('delete failed'))
    const onDeleted = vi.fn()

    const { result } = renderHook(() => useDeleteTask())
    const deleted = await act(async () => result.current.deleteTask('agent-1', 't-1', { onDeleted }))

    expect(deleted).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
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
