import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type * as TaskConversation from '@renderer/services/taskConversation'
import type { TaskConversationResult } from '@renderer/services/taskConversation'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

const { resolve, readPage } = vi.hoisted(() => ({ resolve: vi.fn(), readPage: vi.fn() }))
vi.mock('@renderer/services/taskConversation', async (importOriginal) => ({
  ...(await importOriginal<typeof TaskConversation>()),
  resolveTaskConversation: resolve,
  readTaskConversationPage: readPage
}))
vi.mock('@renderer/hooks/tab', () => ({ useCurrentTabId: () => null }))
vi.mock('@renderer/data/hooks/useDataApi', async () => {
  const { MockUseDataApi } = await import('@test-mocks/renderer/useDataApi')
  const { useDataChange } = await import('@renderer/data/hooks/useDataChange')
  return { ...MockUseDataApi, useDataChange }
})

import { useTaskConversation } from '../useTaskConversation'

beforeEach(() => {
  resolve.mockReset()
  readPage.mockReset().mockResolvedValue({ selectedRun: null, session: null, logs: [], total: 0, nextPage: 2 })
  MockUseDataApiUtils.resetMocks()
})
const task = (id: string) => ({ id, agentId: 'agent', reuseSession: false }) as ScheduledTaskEntity
const result = (id: string): TaskConversationResult => ({
  selectedRun: null,
  session: { id } as never,
  logs: [],
  total: 0,
  nextPage: 2
})

it('immediately clears the previous task and ignores its late resolution', async () => {
  let finishOld!: (value: TaskConversationResult) => void
  let finishNew!: (value: TaskConversationResult) => void
  resolve
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishOld = done
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishNew = done
        })
    )
  const view = renderHook(({ selected }) => useTaskConversation(selected), { initialProps: { selected: task('old') } })
  view.rerender({ selected: task('new') })
  expect(view.result.current.result).toBeUndefined()
  await act(async () => finishNew(result('new-session')))
  await waitFor(() => expect(view.result.current.result?.session?.id).toBe('new-session'))
  await act(async () => finishOld(result('old-session')))
  expect(view.result.current.result?.session?.id).toBe('new-session')
})

it('keeps the selected conversation when the task moves to another group', async () => {
  resolve.mockResolvedValue(result('kept-session'))
  const view = renderHook(({ selected }) => useTaskConversation(selected), { initialProps: { selected: task('task') } })
  await waitFor(() => expect(view.result.current.result?.session?.id).toBe('kept-session'))
  view.rerender({ selected: { ...task('task'), status: 'paused', enabled: false } })
  expect(view.result.current.result?.session?.id).toBe('kept-session')
})

it('retains the conversation when Activity reconnects and refreshes the newer run separately', async () => {
  resolve.mockResolvedValue(selected('old'))
  readPage.mockResolvedValue({ ...result('new-session'), runId: 'new-run' })
  function Conversation() {
    const conversation = useTaskConversation(task('task'))
    return (
      <output>
        {conversation.result?.session?.id}:{conversation.newerRunId}
      </output>
    )
  }
  const view = render(
    <Activity mode="visible">
      <Conversation />
    </Activity>
  )
  await waitFor(() => expect(view.getByRole('status').textContent).toBe('old-session:'))
  view.rerender(
    <Activity mode="hidden">
      <Conversation />
    </Activity>
  )
  resolve.mockResolvedValue({ ...result('new-session'), runId: 'new-run' })
  view.rerender(
    <Activity mode="visible">
      <Conversation />
    </Activity>
  )
  await waitFor(() => expect(view.getByRole('status').textContent).toBe('old-session:new-run'))
})

it('preserves refreshed history when an older page finishes after the refresh', async () => {
  const log = (id: string) => ({ id }) as TaskConversationResult['logs'][number]
  resolve.mockResolvedValue({ ...selected('selected'), logs: [log('selected-run')], total: 100 })
  let finishRefresh!: (value: TaskConversationResult) => void
  let finishOlder!: (value: TaskConversationResult) => void
  readPage.mockImplementation(
    (_task, page) =>
      new Promise((done) => {
        if (page === 1) finishRefresh = done
        else finishOlder = done
      })
  )
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.result?.session?.id).toBe('selected-session'))
  await act(async () =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/agents/:agentId/tasks/:taskId/logs', kind: 'membership', routeParams: { taskId: 'task' } }
    ])
  )
  let loading!: Promise<void>
  act(() => {
    loading = view.result.current.loadMore()
  })
  await act(async () =>
    finishRefresh({ ...result('new-session'), runId: 'new-run', logs: [log('new-run')], total: 101 })
  )
  await act(async () => {
    finishOlder({ ...result('older-session'), logs: [log('older-run')], nextPage: 3, total: 100 })
    await loading
  })
  expect(view.result.current.result?.logs.map((entry) => entry.id)).toEqual(['new-run', 'selected-run', 'older-run'])
  expect(view.result.current.result?.session?.id).toBe('selected-session')
  expect(view.result.current.newerRunId).toBe('new-run')
})

it('announces a newer conversation without replacing the current one, including on retry', async () => {
  resolve.mockResolvedValue(selected('old'))
  readPage.mockResolvedValue({ ...result('new-session'), runId: 'new-run' })
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'old-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.session?.id).toBe('old-session'))
  await act(async () =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/agents/:agentId/tasks/:taskId/logs', kind: 'membership', routeParams: { taskId: 'task' } }
    ])
  )
  await waitFor(() => expect(view.result.current.newerRunId).toBe('new-run'))
  expect(view.result.current.session?.id).toBe('old-session')
  await act(async () => view.result.current.retry())
  expect(view.result.current.session?.id).toBe('old-session')
})

const selected = (id: string, readable = true): TaskConversationResult => ({
  ...result(id + '-session'),
  session: readable ? ({ id: id + '-session' } as never) : null,
  runId: id,
  selectedRun: { id, startedAt: '2026-01-01T00:00:00Z', status: 'completed', result: id + ' text', error: null },
  logs: [{ id: 'readable' }, { id: 'missing' }] as never,
  total: 100
})

it('switches readable → unavailable → readable while retaining history and selected facts', async () => {
  resolve.mockImplementation(async (_task, id) => selected(id, id !== 'missing'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'readable-session' } as never })
  const view = renderHook(({ id }) => useTaskConversation(task('task'), id), { initialProps: { id: 'readable' } })
  await waitFor(() => expect(view.result.current.session?.id).toBe('readable-session'))
  view.rerender({ id: 'missing' })
  expect(view.result.current.result?.logs).toHaveLength(2)
  expect(view.result.current.session).toBeNull()
  await waitFor(() => expect(view.result.current.result?.selectedRun?.result).toBe('missing text'))
  expect(view.result.current.error).toBeUndefined()
  view.rerender({ id: 'readable' })
  await waitFor(() => expect(view.result.current.session?.id).toBe('readable-session'))
})

it.each([true, false])('handles session deletion during verification (expected: %s)', async (expected) => {
  resolve.mockResolvedValue(selected('readable'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'readable-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task'), 'readable'))
  await waitFor(() => expect(view.result.current.session?.id).toBe('readable-session'))
  const error = expected ? DataApiErrorFactory.notFound('Session', 'readable-session') : new Error('timeout')
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { error })
  view.rerender()
  expect(view.result.current.session).toBeNull()
  expect(view.result.current.result?.selectedRun?.result).toBe('readable text')
  expect(view.result.current.error).toBe(expected ? undefined : error)
})

it('ignores a superseded selection response and clears facts on task switch', async () => {
  let finish!: (value: TaskConversationResult) => void
  resolve
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        })
    )
    .mockResolvedValue(selected('new', false))
  const view = renderHook(({ id, taskId }) => useTaskConversation(task(taskId), id), {
    initialProps: { id: 'old', taskId: 'task' }
  })
  view.rerender({ id: 'new', taskId: 'task' })
  await waitFor(() => expect(view.result.current.result?.selectedRun?.id).toBe('new'))
  await act(async () => finish(selected('old')))
  expect(view.result.current.result?.selectedRun?.id).toBe('new')
  view.rerender({ id: 'new', taskId: 'other' })
  expect(view.result.current.result?.selectedRun).toBeUndefined()
})

it('retains explicit unavailable selection across pagination and refresh', async () => {
  resolve.mockResolvedValue(selected('missing', false))
  readPage.mockResolvedValue({ ...selected('new'), nextPage: 3 })
  const view = renderHook(() => useTaskConversation(task('task'), 'missing'))
  await waitFor(() => expect(view.result.current.result?.selectedRun?.id).toBe('missing'))
  await act(async () => view.result.current.loadMore())
  await act(async () =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/agents/:agentId/tasks/:taskId/logs', kind: 'membership', routeParams: { taskId: 'task' } }
    ])
  )
  expect(view.result.current.result?.selectedRun?.result).toBe('missing text')
  expect(view.result.current.result?.session).toBeNull()
})

it.each([false, true])(
  'refreshes an explicit queued run on history changes (session available: %s)',
  async (readable) => {
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'queued-session' } as never })
    const pending = selected('queued', false)
    pending.selectedRun = { ...pending.selectedRun!, status: 'pending', result: null }
    resolve.mockResolvedValue(pending)
    readPage.mockResolvedValue(selected('another'))
    const view = renderHook(() => useTaskConversation(task('task'), 'queued'))
    await waitFor(() => expect(view.result.current.result?.selectedRun?.status).toBe('pending'))
    const completed = selected('queued', readable)
    resolve.mockImplementation(async (_task, id) => (id === 'queued' ? completed : selected('another')))
    await act(async () =>
      MockUseDataApiUtils.emitDataChange([
        { endpoint: '/agents/:agentId/tasks/:taskId/logs', kind: 'membership', routeParams: { taskId: 'task' } }
      ])
    )
    await waitFor(() => expect(view.result.current.result?.selectedRun).toEqual(completed.selectedRun))
    expect(view.result.current.result?.runId).toBe('queued')
    expect(view.result.current.result?.session).toEqual(completed.session)
    expect(view.result.current.error).toBeUndefined()
  }
)

const historyChanged = async () => {
  await act(async () =>
    MockUseDataApiUtils.emitDataChange([
      { endpoint: '/agents/:agentId/tasks/:taskId/logs', kind: 'membership', routeParams: { taskId: 'task' } }
    ])
  )
}
const pendingRun = (): TaskConversationResult => ({
  ...selected('run'),
  selectedRun: { ...selected('run').selectedRun!, status: 'running', result: null }
})

it.each([false, true])(
  'adopts refreshed automatic state with no selection (retained initial: %s)',
  async (retained) => {
    const empty: TaskConversationResult = { selectedRun: null, session: null, logs: [], total: 0, nextPage: 2 }
    resolve.mockResolvedValue(retained ? selected('previous', false) : empty)
    const view = renderHook(({ id }: { id?: string }) => useTaskConversation(task('task'), id), {
      initialProps: { id: retained ? 'previous' : undefined }
    })
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    let finishInitial: ((value: TaskConversationResult) => void) | undefined
    if (retained) {
      resolve.mockImplementationOnce(
        () =>
          new Promise((done) => {
            finishInitial = done
          })
      )
      view.rerender({ id: undefined })
      expect(view.result.current.result?.logs).toHaveLength(2)
      expect(view.result.current.result?.selectedRun).toBeNull()
    }
    const refreshed = retained ? empty : { ...selected('first'), startedAt: '2026-01-01T00:00:00Z' }
    resolve.mockResolvedValueOnce(refreshed)
    MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'first-session' } as never })
    await historyChanged()
    const expected = retained ? { ...empty, logs: selected('previous', false).logs, total: 100 } : refreshed
    expect(view.result.current.result).toEqual(expected)
    expect(view.result.current.session?.id).toBe(retained ? undefined : 'first-session')
    expect(view.result.current.newerRunId).toBeUndefined()
    expect(view.result.current.loading).toBe(false)
    if (finishInitial) {
      await act(async () => finishInitial!(selected('stale')))
      expect(view.result.current.result).toEqual(expected)
    }
  }
)

it('keeps the bound reuse conversation and null run facts after a history refresh', async () => {
  const boundTask = { ...task('task'), reuseSession: true, reuseSessionId: 'bound-session' }
  resolve.mockResolvedValue(result('bound-session'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'bound-session' } as never })
  const view = renderHook(() => useTaskConversation(boundTask))
  await waitFor(() => expect(view.result.current.session?.id).toBe('bound-session'))
  const refreshed = selected('history')
  readPage.mockResolvedValue(refreshed)

  await historyChanged()

  expect(view.result.current.result?.session?.id).toBe('bound-session')
  expect(view.result.current.result?.selectedRun).toBeNull()
  expect(view.result.current.result?.runId).toBeUndefined()
  expect(view.result.current.result?.startedAt).toBeUndefined()
  expect(view.result.current.result?.logs).toEqual(refreshed.logs)
  expect(view.result.current.session?.id).toBe('bound-session')
  expect(view.result.current.error).toBeUndefined()
})

it('refreshes the selected running row behind a newer run before session deletion exposes its stored result', async () => {
  resolve.mockResolvedValue(pendingRun())
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  expect(view.result.current.result?.selectedRun?.status).toBe('running')
  const completed = {
    id: 'run',
    startedAt: '2026-01-02T00:00:00Z',
    status: 'completed' as const,
    result: 'stored result from A',
    error: null
  }
  readPage.mockResolvedValue({
    ...selected('newer'),
    logs: [
      { ...selected('newer').selectedRun!, scheduleId: 'task', durationMs: 10 },
      { ...completed, scheduleId: 'task', durationMs: 20, sessionId: 'run-session' }
    ]
  })
  await historyChanged()
  expect(view.result.current.result?.selectedRun).toEqual(completed)
  expect(view.result.current.result?.runId).toBe('run')
  expect(view.result.current.result?.startedAt).toBe(completed.startedAt)
  expect(view.result.current.session?.id).toBe('run-session')
  expect(view.result.current.newerRunId).toBe('newer')
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
    error: DataApiErrorFactory.notFound('Session', 'run-session')
  })
  view.rerender()
  expect(view.result.current.session).toBeNull()
  expect(view.result.current.result?.selectedRun).toEqual(completed)
  expect(view.result.current.error).toBeUndefined()
})

it('applies a later-issued refresh before initial resolution and ignores the late initial facts', async () => {
  let finishInitial!: (value: TaskConversationResult) => void
  resolve
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishInitial = done
        })
    )
    .mockResolvedValue(selected('run'))
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await historyChanged()
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.loading).toBe(false)
  await act(async () => finishInitial(pendingRun()))
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.result?.runId).toBe('run')
})

it('keeps the later-issued refresh facts when two refreshes resolve in reverse order', async () => {
  resolve.mockResolvedValue(pendingRun())
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await waitFor(() => expect(view.result.current.result?.selectedRun?.status).toBe('running'))
  let finishOlder!: (value: TaskConversationResult) => void
  resolve
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishOlder = done
        })
    )
    .mockResolvedValueOnce(selected('run'))
  await historyChanged()
  await historyChanged()
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  await act(async () => finishOlder(pendingRun()))
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.result?.runId).toBe('run')
})

it('refreshes automatic run facts before session deletion exposes its stored result', async () => {
  resolve.mockResolvedValue(pendingRun())
  readPage.mockResolvedValue(selected('run'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  await historyChanged()
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', {
    error: DataApiErrorFactory.notFound('Session', 'run-session')
  })
  view.rerender()
  expect(view.result.current.session).toBeNull()
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.error).toBeUndefined()
})

it('retains automatic run facts when a newer run appears in history', async () => {
  resolve.mockResolvedValue(selected('run'))
  readPage.mockResolvedValue(selected('newer'))
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.result?.runId).toBe('run'))
  await historyChanged()
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.result?.runId).toBe('run')
  expect(view.result.current.newerRunId).toBe('newer')
})

it('keeps a verified conversation without an error when a background job lookup fails', async () => {
  resolve.mockResolvedValue(selected('run'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  resolve.mockRejectedValue(DataApiErrorFactory.notFound('Job', 'run'))
  await historyChanged()
  expect(view.result.current.session?.id).toBe('run-session')
  expect(view.result.current.result?.selectedRun).toEqual(selected('run').selectedRun)
  expect(view.result.current.error).toBeUndefined()
})

it('surfaces an initial job lookup failure and allows retry to recover', async () => {
  const error = DataApiErrorFactory.notFound('Job', 'run')
  resolve.mockRejectedValue(error)
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await waitFor(() => expect(view.result.current.error).toBe(error))
  expect(view.result.current.session).toBeNull()
  expect(view.result.current.loading).toBe(false)
  resolve.mockResolvedValue(selected('run', false))
  await act(async () => view.result.current.retry())
  await waitFor(() => expect(view.result.current.result?.selectedRun).toEqual(selected('run', false).selectedRun))
  expect(view.result.current.error).toBeUndefined()
})

it('round 9 retains the open explicit session while recovery updates all run facts', async () => {
  resolve.mockResolvedValue(pendingRun())
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  const recovered: TaskConversationResult = {
    ...selected('run'),
    session: { id: 'recovered-session' } as never,
    startedAt: '2026-02-01T00:00:00Z',
    selectedRun: {
      id: 'run',
      status: 'failed',
      result: 'partial output',
      error: 'recovery failed',
      startedAt: '2026-02-01T00:00:00Z'
    }
  }
  resolve.mockResolvedValue(recovered)
  readPage.mockResolvedValue(recovered)
  await historyChanged()
  expect(view.result.current.session?.id).toBe('run-session')
  expect(view.result.current.result?.session?.id).toBe('run-session')
  expect(view.result.current.result?.selectedRun).toEqual(recovered.selectedRun)
  expect(view.result.current.result?.startedAt).toBe('2026-02-01T00:00:00Z')
})

it('round 9 exposes an Older error without dropping the verified session', async () => {
  resolve.mockResolvedValue(selected('run'))
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  const error = new Error('Older unavailable')
  readPage.mockRejectedValue(error)
  await act(async () => view.result.current.loadMore())
  expect(view.result.current.session?.id).toBe('run-session')
  expect(view.result.current.error).toBe(error)
})

it('round 9 retains stored facts after background failure while preserving task errors', async () => {
  const failed = selected('run', false)
  failed.selectedRun = { ...failed.selectedRun!, status: 'failed', error: 'task execution failed' }
  resolve.mockResolvedValue(failed)
  const view = renderHook(() => useTaskConversation(task('task'), 'run'))
  await waitFor(() => expect(view.result.current.result?.selectedRun?.status).toBe('failed'))
  resolve.mockRejectedValue(new Error('background unavailable'))
  await historyChanged()
  expect(view.result.current.error).toBeUndefined()
  expect(view.result.current.session).toBeNull()
  expect(view.result.current.result?.selectedRun).toEqual(failed.selectedRun)
  expect(view.result.current.result?.selectedRun?.error).toBe('task execution failed')
})

it('round 9 retains a session when a refresh started before verification rejects afterward', async () => {
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: undefined, isLoading: true })
  resolve.mockResolvedValue(selected('run'))
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.result?.session?.id).toBe('run-session'))
  expect(view.result.current.session).toBeNull()
  let rejectRefresh!: (error: Error) => void
  readPage.mockImplementation(
    () =>
      new Promise((_done, reject) => {
        rejectRefresh = reject
      })
  )
  await historyChanged()
  MockUseDataApiUtils.mockQueryResult('/agent-sessions/:sessionId', { data: { id: 'run-session' } as never })
  view.rerender()
  await waitFor(() => expect(view.result.current.session?.id).toBe('run-session'))
  await act(async () => rejectRefresh(new Error('background unavailable')))
  expect(view.result.current.error).toBeUndefined()
  expect(view.result.current.session?.id).toBe('run-session')
})

it('round 9 offers the latest conversation for an explicit older run and clears it on selection', async () => {
  resolve.mockResolvedValue(selected('old'))
  const view = renderHook(({ id }) => useTaskConversation(task('task'), id), { initialProps: { id: 'old' } })
  await waitFor(() => expect(view.result.current.result?.runId).toBe('old'))
  const newest = {
    ...selected('new'),
    logs: [{ id: 'new' }, { id: 'old' }] as TaskConversationResult['logs'],
    total: 101
  }
  let finishSelected!: (value: TaskConversationResult) => void
  let finishPage: ((value: TaskConversationResult) => void) | undefined
  resolve.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishSelected = done
      })
  )
  readPage.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishPage = done
      })
  )
  await historyChanged()
  await act(async () => {
    finishPage?.(newest)
  })
  expect(view.result.current.newerRunId).toBeUndefined()
  await act(async () => {
    finishSelected(selected('old'))
  })
  expect(view.result.current.newerRunId).toBe('new')
  expect(view.result.current.result?.selectedRun).toEqual(selected('old').selectedRun)
  expect(view.result.current.result?.session?.id).toBe('old-session')
  expect(view.result.current.result?.logs.map((log) => log.id)).toEqual(['new', 'old', 'readable', 'missing'])
  expect(view.result.current.result?.total).toBe(101)
  resolve.mockResolvedValue(newest)
  readPage.mockResolvedValue(newest)
  view.rerender({ id: 'new' })
  await waitFor(() => expect(view.result.current.result?.session?.id).toBe('new-session'))
  await historyChanged()
  expect(view.result.current.newerRunId).toBeUndefined()
})

it('round 9 keeps all loaded older rows and pagination when adopting refreshed automatic state', async () => {
  const logs = Array.from({ length: 100 }, (_, index) => ({ id: String(index) })) as TaskConversationResult['logs']
  const empty = { selectedRun: null, session: null, logs: logs.slice(0, 50), total: 150, nextPage: 2 }
  resolve.mockResolvedValue(empty)
  const view = renderHook(() => useTaskConversation(task('task')))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  readPage.mockResolvedValue({ ...empty, logs: logs.slice(50), nextPage: 3 })
  await act(async () => view.result.current.loadMore())
  expect(view.result.current.result?.logs).toHaveLength(100)
  resolve.mockResolvedValue({ ...empty, total: 100 })
  await historyChanged()
  expect(view.result.current.result?.logs.map((log) => log.id)).toEqual(logs.map((log) => log.id))
  expect(view.result.current.result?.nextPage).toBe(3)
  expect(view.result.current.result?.total).toBe(150)
  expect(view.result.current.hasMore).toBe(true)
})
