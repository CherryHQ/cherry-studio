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
  readPage.mockReset()
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
  resolve.mockResolvedValue(result('old-session'))
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
  resolve.mockResolvedValue({ ...result('selected-session'), logs: [log('selected-run')], total: 100 })
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
  resolve.mockResolvedValue(result('old-session'))
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
