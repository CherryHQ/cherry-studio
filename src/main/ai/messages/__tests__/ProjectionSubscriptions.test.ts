import { EventEmitter } from 'node:events'

import { expect, it } from 'vitest'

import {
  applyMessageProjectionUpdate,
  type ChildProjectionState,
  type MessageProjectionUpdate,
  type TopicProjectionState
} from '@shared/ai/messageProjection'

import { MessageProjection } from '../MessageProjection'
import { ProjectionSubscriptions } from '../ProjectionSubscriptions'

function sender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as Electron.WebContents
}

// Destroying a window or cancelling an in-flight attach must not install an orphan listener.
it('fences a cancelled asynchronous attach and releases delivery on window destruction', async () => {
  const subscriptions = new ProjectionSubscriptions()
  const source = new MessageProjection<TopicProjectionState>({
    kind: 'topic' as const,
    topicId: 't',
    executions: [],
    messages: []
  })
  const window = sender()
  let resolve!: (value: typeof source) => void
  const updates: MessageProjectionUpdate[] = []
  const pending = subscriptions.attach(
    window,
    'first',
    () =>
      new Promise((done) => {
        resolve = done
      }),
    (update) => updates.push(update)
  )
  subscriptions.detach(window, 'first')
  resolve(source)
  expect(await pending).toBeNull()
  expect(source.observed).toBe(false)
  await subscriptions.attach(
    window,
    'second',
    () => source,
    (update) => updates.push(update)
  )
  window.emit('destroyed')
  expect(source.observed).toBe(false)
  source.update(
    { kind: 'topic', topicId: 't', executions: [], messages: [{ id: 'm', role: 'assistant', parts: [] }] },
    true
  )
  expect(updates).toEqual([])
})

// Parent completion must neither terminate child delivery nor mix a sibling's messages into it.
it('keeps parent and child publishers independent over the same delivery protocol', async () => {
  const subscriptions = new ProjectionSubscriptions()
  const root = new MessageProjection<TopicProjectionState>({
    kind: 'topic' as const,
    topicId: 'root',
    executions: [],
    messages: []
  })
  const childState = {
    kind: 'child' as const,
    contextId: 'c',
    sessionId: 'child',
    active: true,
    available: true,
    canSubmit: true
  }
  const child = new MessageProjection<ChildProjectionState>({ ...childState, messages: [] })
  const window = sender()
  const rootUpdates: MessageProjectionUpdate[] = []
  const childUpdates: MessageProjectionUpdate[] = []
  await subscriptions.attach(
    window,
    'root',
    () => root,
    (update) => rootUpdates.push(update)
  )
  await subscriptions.attach(
    window,
    'child',
    () => child,
    (update) => childUpdates.push(update)
  )
  subscriptions.detach(window, 'root')
  root.dispose()
  child.update(
    {
      ...childState,
      messages: [{ id: 'child-message', role: 'assistant', parts: [{ type: 'text', text: 'still working' }] }]
    },
    true
  )
  expect(rootUpdates).toEqual([])
  expect(childUpdates[0]).toMatchObject({ kind: 'child', active: true, order: ['child-message'] })
  subscriptions.dispose()
  expect(child.observed).toBe(false)
})

it('starts a new revision domain on reattachment without accepting retired publisher updates', async () => {
  const subscriptions = new ProjectionSubscriptions()
  const state: TopicProjectionState = { kind: 'topic', topicId: 'root', executions: [] }
  const previous = new MessageProjection<TopicProjectionState>({ ...state, messages: [] })
  const next = new MessageProjection<TopicProjectionState>({ ...state, messages: [] })
  const window = sender()
  let view = previous.snapshot()
  const receive = (update: MessageProjectionUpdate) => {
    view = applyMessageProjectionUpdate(view, update as MessageProjectionUpdate<TopicProjectionState>)!
  }
  await subscriptions.attach(window, 'previous', () => previous, receive)
  previous.update({ ...state, messages: [{ id: 'old', role: 'assistant', parts: [] }] }, true)
  expect(view.revision).toBe(1)

  subscriptions.detach(window, 'previous')
  view = (await subscriptions.attach(window, 'next', () => next, receive)) as typeof view
  expect(view.revision).toBe(0)
  previous.update({ ...state, messages: [{ id: 'retired', role: 'assistant', parts: [] }] }, true)
  next.update({ ...state, messages: [{ id: 'current', role: 'assistant', parts: [] }] }, true)
  expect(view.messages.map((message) => message.id)).toEqual(['current'])
  expect(view.revision).toBe(1)
  subscriptions.dispose()
})
