import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { getCherryCloudTargetAdvice, hasKnownExhaustedTarget } from '@renderer/utils/cherryCloudTargetAdvice'
import type { ComposerQueuedMessagePayload, TopicStreamStatus } from '@shared/ai/transport'

import type { ComposerSerializedDraft } from '../tokens'
import { type FollowupDrainResult, type FollowupEditOptions, useFollowupQueue } from '../useFollowupQueue'

const drainResult = (sent: boolean): FollowupDrainResult => ({ status: sent ? 'submitted' : 'failed' })

// Exercise production deep-equality suppression, rather than the always-notifying cache mock.
vi.unmock('@data/CacheService')

function setup() {
  const scopeKey = crypto.randomUUID()
  const attempts: string[] = []
  const finishes = new Map<string, (sent: boolean) => void>()
  const useQueue = ({ lastCompletedAt }: { lastCompletedAt: number }) =>
    useFollowupQueue({
      scopeKey,
      status: 'done',
      lastCompletedAt,
      onDrain: ({ text }) => {
        attempts.push(text)
        return new Promise<boolean>((resolve) => finishes.set(text, resolve)).then(drainResult)
      }
    })
  const hook = renderHook(useQueue, { initialProps: { lastCompletedAt: 100 } })
  act(() => {
    for (const text of ['A', 'B', 'C']) {
      hook.result.current.enqueue({ text, tokens: [] }, { text, userMessageParts: [] })
    }
  })
  expect(attempts).toEqual(['A'])
  const finish = async (text: string, sent = true) => {
    await act(async () => finishes.get(text)!(sent))
  }
  return { ...hook, useQueue, attempts, finish }
}

it.each(['A', 'C'])(
  'consumes a manually steered completion while an older send is pending (%s settles first)',
  async (first) => {
    const q = setup()
    q.rerender({ lastCompletedAt: 200 })
    act(() => void q.result.current.sendId(q.result.current.items[2].id))
    expect(q.attempts).toEqual(['A', 'C'])

    await q.finish(first)
    expect(q.attempts).toEqual(['A', 'C'])
    await q.finish(first === 'A' ? 'C' : 'A')
    expect(q.attempts).toEqual(['A', 'C'])
    expect(q.result.current.items.map(({ payload }) => payload.text)).toEqual(['B'])

    q.unmount()
    const next = renderHook(q.useQueue, { initialProps: { lastCompletedAt: 200 } })
    expect(q.attempts).toEqual(['A', 'C'])
    next.rerender({ lastCompletedAt: 300 })
    expect(q.attempts).toEqual(['A', 'C', 'B'])
    await q.finish('B')
  }
)

it.each([false, true])('wakes the next draft after an already-removed send settles (remount=%s)', async (remount) => {
  const q = setup()
  act(() => q.result.current.removeId(q.result.current.items[0].id))
  q.rerender({ lastCompletedAt: 200 })
  if (remount) {
    q.unmount()
    renderHook(q.useQueue, { initialProps: { lastCompletedAt: 200 } })
  }
  expect(q.attempts).toEqual(['A'])
  await q.finish('A')
  expect(q.attempts).toEqual(['A', 'B'])
  await q.finish('B')
  expect(q.attempts).toEqual(['A', 'B'])
})

it('keeps all older claims pending when the newest manual send settles first', async () => {
  const q = setup()
  q.rerender({ lastCompletedAt: 200 })
  act(() => void q.result.current.sendId(q.result.current.items[2].id))
  await q.finish('C')
  q.rerender({ lastCompletedAt: 300 })
  expect(q.attempts).toEqual(['A', 'C'])
  await q.finish('A')
  expect(q.attempts).toEqual(['A', 'C', 'B'])
  await q.finish('B')
})

it.each(['A', 'C'])('preserves the newer consumption when the older send fails (%s settles first)', async (first) => {
  const q = setup()
  q.rerender({ lastCompletedAt: 200 })
  act(() => void q.result.current.sendId(q.result.current.items[2].id))
  await q.finish(first, first !== 'A')
  await q.finish(first === 'A' ? 'C' : 'A', first === 'A')
  expect(q.result.current.paused).toBe(true)
  act(() => q.result.current.setPaused(false))
  expect(q.attempts).toEqual(['A', 'C'])
  expect(q.result.current.items.map(({ payload }) => payload.text)).toEqual(['A', 'B'])
  q.rerender({ lastCompletedAt: 300 })
  expect(q.attempts).toEqual(['A', 'C', 'A'])
  await q.finish('A')
})

it('releases a failed newer completion for retry without dropping the older pending claim', async () => {
  const q = setup()
  q.rerender({ lastCompletedAt: 200 })
  act(() => void q.result.current.sendId(q.result.current.items[2].id))
  await q.finish('C', false)
  expect(q.result.current.paused).toBe(true)
  act(() => q.result.current.setPaused(false))
  expect(q.attempts).toEqual(['A', 'C'])
  await q.finish('A')
  expect(q.attempts).toEqual(['A', 'C', 'B'])
  await q.finish('B')
  expect(q.result.current.items.map(({ payload }) => payload.text)).toEqual(['C'])
})

it.each(['A', 'C'])(
  'keeps a same-completion success consumed when its peer fails (%s settles first)',
  async (first) => {
    const q = setup()
    act(() => void q.result.current.sendId(q.result.current.items[2].id))
    await q.finish(first, first !== 'A')
    await q.finish(first === 'A' ? 'C' : 'A', first === 'A')
    act(() => q.result.current.setPaused(false))
    expect(q.attempts).toEqual(['A', 'C'])
    q.rerender({ lastCompletedAt: 200 })
    expect(q.attempts).toEqual(['A', 'C', 'A'])
    await q.finish('A')
  }
)

it.each([false, true])('settles a manual send that started before completion (success=%s)', async (sent) => {
  const attempts: string[] = []
  let finish!: (sent: boolean) => void
  const scopeKey = crypto.randomUUID()
  const q = renderHook(
    ({ status }: { status: TopicStreamStatus }) =>
      useFollowupQueue({
        scopeKey,
        status,
        lastCompletedAt: status === 'done' ? 200 : null,
        onDrain: ({ text }) => {
          attempts.push(text)
          return attempts.length === 1
            ? new Promise<boolean>((resolve) => (finish = resolve)).then(drainResult)
            : Promise.resolve(drainResult(true))
        }
      }),
    { initialProps: { status: 'streaming' as TopicStreamStatus } }
  )
  act(() => {
    for (const text of ['A', 'B']) q.result.current.enqueue({ text, tokens: [] }, { text, userMessageParts: [] })
  })
  act(() => void q.result.current.sendId(q.result.current.items[0].id))
  q.rerender({ status: 'done' })
  expect(attempts).toEqual(['A'])
  await act(async () => finish(sent))
  if (!sent) {
    expect(q.result.current.paused).toBe(true)
    expect(attempts).toEqual(['A'])
    await act(async () => q.result.current.setPaused(false))
  }
  expect(attempts).toEqual(['A', sent ? 'B' : 'A'])
})

it('preserves the edited draft position when another mounted sender settles after unmount', async () => {
  const scopeKey = crypto.randomUUID()
  let finish!: (sent: boolean) => void
  const useQueue = () =>
    useFollowupQueue({
      scopeKey,
      status: 'streaming',
      lastCompletedAt: null,
      onDrain: () => new Promise<boolean>((resolve) => (finish = resolve)).then(drainResult)
    })
  const sender = renderHook(useQueue)
  act(() => {
    for (const text of ['A', 'B', 'C', 'D']) {
      sender.result.current.enqueue({ text, tokens: [] }, { text, userMessageParts: [] })
    }
  })
  const editor = renderHook(useQueue)
  const [a, b, , d] = editor.result.current.items
  const capture = () => ({ draft: b.draft, payload: b.payload })
  act(() => {
    void sender.result.current.sendId(a.id)
    expect(editor.result.current.takeForEdit(b.id, capture)).toEqual(b)
  })
  sender.unmount()
  await act(async () => finish(true))
  act(() => {
    editor.result.current.takeForEdit(d.id, () => ({
      draft: { text: 'B edited', tokens: [] },
      payload: { text: 'B edited', userMessageParts: [] }
    }))
  })
  expect(editor.result.current.items.map(({ draft }) => draft.text)).toEqual(['B edited', 'C'])
})

it('resumes an edited deferred draft with its new target after switching to another queued draft', async () => {
  const scopeKey = crypto.randomUUID()
  const exhaustedTarget = 'cherryai-subscription::exhausted'
  const healthyTarget = 'openai::healthy'
  const attempts: ComposerQueuedMessagePayload[] = []
  const submitted: ComposerQueuedMessagePayload[] = []
  const useQueue = ({ status }: { status: TopicStreamStatus }) =>
    useFollowupQueue({
      scopeKey,
      status,
      lastCompletedAt: 100,
      wakeupKey: 'account:1:fresh',
      onDrain: async (payload): Promise<FollowupDrainResult> => {
        attempts.push(payload)
        const advice = getCherryCloudTargetAdvice(payload.mentionedModels, {
          freshness: 'fresh',
          isModelUnavailable: (model) => model.id === exhaustedTarget
        })
        if (hasKnownExhaustedTarget(advice)) return { status: 'deferred' }
        submitted.push(payload)
        return { status: 'submitted' }
      }
    })
  const queue = renderHook(useQueue, { initialProps: { status: 'streaming' as TopicStreamStatus } })
  act(() => {
    for (const text of ['A', 'B', 'C']) {
      queue.result.current.enqueue(
        { text, tokens: [] },
        { text, userMessageParts: [], mentionedModels: [text === 'A' ? exhaustedTarget : healthyTarget] }
      )
    }
  })
  const [a, b, c] = queue.result.current.items
  await act(async () => queue.rerender({ status: 'done' }))
  expect(attempts.map(({ text }) => text)).toEqual(['A'])
  expect(submitted).toEqual([])

  let editorDraft: ComposerSerializedDraft = { text: '', tokens: [] }
  let editorTargets: ComposerQueuedMessagePayload['mentionedModels']
  const editor: FollowupEditOptions = {
    editingMessage: false,
    getDraft: () => editorDraft,
    buildPayload: (draft) => ({ text: draft.text, userMessageParts: [], mentionedModels: editorTargets }),
    hasFiles: false,
    restore: (item) => {
      editorDraft = item.draft
      editorTargets = item.payload.mentionedModels
    }
  }
  act(() => queue.result.current.setPaused(true))
  act(() => queue.result.current.editItem(a.id, editor))
  editorDraft = { text: 'A edited', tokens: [] }
  editorTargets = [healthyTarget]
  act(() => queue.result.current.editItem(b.id, editor))
  expect(editorDraft.text).toBe('B')
  expect(queue.result.current.items.map(({ id }) => id)).toEqual([a.id, c.id])
  expect(queue.result.current.items[0].payload.mentionedModels).toEqual([healthyTarget])
  expect(submitted).toEqual([])

  queue.unmount()
  const resumed = renderHook(useQueue, { initialProps: { status: 'done' as TopicStreamStatus } })
  expect(resumed.result.current.paused).toBe(true)
  await act(async () => resumed.result.current.setPaused(false))
  expect(submitted.map(({ text, mentionedModels }) => ({ text, mentionedModels }))).toEqual([
    { text: 'A edited', mentionedModels: [healthyTarget] }
  ])
  expect(attempts.map(({ text }) => text)).toEqual(['A', 'A edited'])
  expect(resumed.result.current.items.map(({ id }) => id)).toEqual([c.id])
  resumed.rerender({ status: 'done' })
  expect(attempts.map(({ text }) => text)).toEqual(['A', 'A edited'])
})
