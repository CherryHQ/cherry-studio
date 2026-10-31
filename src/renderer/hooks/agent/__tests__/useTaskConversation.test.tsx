import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { TaskConversationResult } from '@renderer/services/taskConversation'
import type { ScheduledTaskEntity } from '@shared/data/api/schemas/agents'

const { resolve, readPage } = vi.hoisted(() => ({ resolve: vi.fn(), readPage: vi.fn() }))
vi.mock('@renderer/services/taskConversation', () => ({
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
const result = (id: string): TaskConversationResult => ({ session: { id } as never, logs: [], total: 0, nextPage: 2 })

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
