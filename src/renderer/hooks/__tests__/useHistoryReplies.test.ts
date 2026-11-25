import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { MessageProjectionView, ProjectedExecution, TopicProjectionState } from '@shared/ai/messageProjection'

import { useHistoryReplies } from '../useHistoryReplies'
import type { ReplyHistory } from '../useHistoryRowUpdates'

const storedRow = { id: 'same-anchor', status: 'success' as const }
const hasStored = (id: string) => id === storedRow.id
function history(
  refresh: (id: string) => Promise<unknown> = async () => {},
  row: Extract<ReturnType<ReplyHistory['lookup']>, { kind: 'row' }>['row'] = storedRow
): ReplyHistory {
  return {
    layout: row?.id === storedRow.id ? hasStored : row,
    lookup: (id) => (row?.id === id ? { kind: 'row', row } : { kind: 'unknown' }),
    refreshRow: async (id) => {
      await refresh(id)
      return 'written'
    }
  }
}
const view = (
  attemptId: number,
  status: ProjectedExecution['status'] = 'done',
  topicId = 'topic'
): MessageProjectionView<TopicProjectionState> => ({
  kind: 'topic',
  topicId,
  revision: attemptId,
  executions: [
    {
      executionId: 'p::m',
      attemptId,
      messageId: 'same-anchor',
      ...(status === 'unresolved'
        ? { status, persistenceError: { message: 'failed', stack: null, name: 'Error' } }
        : status === 'active'
          ? { status }
          : { status, savedMessageId: 'same-anchor' })
    }
  ],
  messages: [{ id: 'same-anchor', role: 'assistant', parts: [{ type: 'text', text: String(attemptId) }] }]
})

it('keeps a later settled retry visible when an earlier history read for the same anchor resolves', async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const refresh = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const hook = renderHook(({ attempt }) => useHistoryReplies(view(attempt), [], history(refresh), 'done'), {
    initialProps: { attempt: 1 }
  })
  hook.rerender({ attempt: 2 })
  await act(async () => first.resolve())
  expect(hook.result.current[0].parts).toEqual([{ type: 'text', text: '2' }])
  await act(async () => second.resolve())
  expect(hook.result.current).toEqual([])
})

it('retains the only readable terminal body when history fails or still contains a pending reservation', async () => {
  const terminal = view(3)
  const placeholder = { ...storedRow, status: 'pending' as const }
  const read = Promise.withResolvers<void>()
  const failed = renderHook(({ source }) => useHistoryReplies(terminal, [], source, 'done'), {
    initialProps: { source: history(() => read.promise) }
  })
  await act(async () => read.reject(new Error('offline')))
  expect(failed.result.current).toEqual(terminal.messages)
  failed.rerender({ source: history(undefined, { ...storedRow }) })
  expect(failed.result.current).toEqual([])

  const late = renderHook(({ source }) => useHistoryReplies(terminal, [], source, 'done'), {
    initialProps: { source: history(undefined, placeholder) }
  })
  await act(async () => {})
  expect(late.result.current).toEqual(terminal.messages)
  late.rerender({ source: history() })
  expect(late.result.current).toEqual([])
})

it('keeps an approval visible until history can take over and retains unresolved output', async () => {
  const refresh = vi.fn(async () => {})
  const hook = renderHook(
    ({ ready, state }) => useHistoryReplies(view(1, state), [], history(refresh), ready ? 'done' : 'awaiting-approval'),
    {
      initialProps: { ready: false, state: 'done' as ProjectedExecution['status'] }
    }
  )
  expect(hook.result.current).toHaveLength(1)
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => hook.rerender({ ready: true, state: 'done' }))
  expect(hook.result.current).toEqual([])
  hook.rerender({ ready: true, state: 'unresolved' })
  expect(hook.result.current).toHaveLength(1)
})

it('keeps a lone terminal reply while the topic may still enter approval, and hands off one finished model while another streams', async () => {
  const first = view(4)
  const next = {
    ...first,
    executions: [
      ...first.executions,
      {
        executionId: 'p::n' as const,
        attemptId: 5,
        messageId: 'other',
        status: 'active' as const
      }
    ],
    messages: [...first.messages, { id: 'other', role: 'assistant' as const, parts: [] }]
  }
  const refresh = vi.fn(async () => {})
  const hook = renderHook(({ topic }) => useHistoryReplies(topic, [], history(refresh), 'streaming'), {
    initialProps: { topic: first }
  })
  expect(hook.result.current).toEqual(first.messages)
  expect(refresh).not.toHaveBeenCalled()
  await act(async () => hook.rerender({ topic: next }))
  expect(hook.result.current.map((message) => message.id)).toEqual(['other'])
})

it('keeps an edited or deleted reply under history ownership when the next turn starts', async () => {
  const terminal = view(8)
  const refresh = vi.fn(async () => {})
  const { result, rerender } = renderHook(
    ({ nextTurn }: { nextTurn: boolean }) =>
      useHistoryReplies(terminal, [], history(refresh), nextTurn ? 'awaiting-approval' : 'done'),
    { initialProps: { nextTurn: false } }
  )
  await act(async () => {})
  expect(result.current).toEqual([])
  rerender({ nextTurn: true })
  expect(result.current).toEqual([])
})

it('filters an older attempt for the same model before the replacement frame arrives', () => {
  const hook = renderHook(() =>
    useHistoryReplies(
      view(1, 'active'),
      [{ executionId: 'p::m', attemptId: 2, seedFromEmpty: true }],
      history(),
      'done'
    )
  )
  expect(hook.result.current).toEqual([])
})

it('uses the committed row ID and keeps output when a terminal has no durable write', async () => {
  const first = view(12)
  const committed = { id: 'sqlite-id', status: 'success' as const }
  const read = vi.fn(async () => {})
  const source = history(read, committed)
  const terminal = (saved: boolean): typeof first => ({
    ...first,
    executions: [
      {
        executionId: 'p::m',
        attemptId: 12,
        messageId: 'same-anchor',
        status: 'done',
        ...(saved && { savedMessageId: committed.id })
      }
    ]
  })
  const hook = renderHook(({ saved }) => useHistoryReplies(terminal(saved), [], source, 'done'), {
    initialProps: { saved: false }
  })
  expect(hook.result.current).toEqual(first.messages)
  expect(read).not.toHaveBeenCalled()
  await act(async () => hook.rerender({ saved: true }))
  expect(read).toHaveBeenCalledExactlyOnceWith('sqlite-id')
  expect(hook.result.current).toEqual([])
})

it('rereads a committed ID when a concurrent branch refresh reinstalls an older placeholder', async () => {
  const terminal = view(9)
  const first = history()
  const read = Promise.withResolvers<void>()
  let stored: NonNullable<Extract<ReturnType<ReplyHistory['lookup']>, { kind: 'row' }>['row']> = {
    ...storedRow,
    status: 'pending'
  }
  const next: ReplyHistory = {
    layout: {},
    lookup: () => ({ kind: 'row', row: stored }),
    refreshRow: async () => {
      await read.promise
      stored = storedRow
      return 'written'
    }
  }
  const hook = renderHook(({ source }) => useHistoryReplies(terminal, [], source, 'done'), {
    initialProps: { source: first }
  })
  await act(async () => {})
  expect(hook.result.current).toEqual([])
  hook.rerender({ source: next })
  expect(hook.result.current).toEqual(terminal.messages)
  await act(async () => read.resolve())
  expect(hook.result.current).toEqual([])
})
