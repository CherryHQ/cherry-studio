import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
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
  expect(resolve).toHaveBeenCalledTimes(1)
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
