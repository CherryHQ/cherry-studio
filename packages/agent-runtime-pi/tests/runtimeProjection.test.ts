import { expect, it, vi } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { PiProjection } from '../src/runtimeProjection'
import { assistantReply, createTestSession, scriptedModel } from './sessionSupport'

it('restores history with a linear message-copy budget', async () => {
  const history = Array.from({ length: 32 }, (_, index) => assistantReply(`saved-${index}`))
  const { model } = scriptedModel([assistantReply('unused')])
  const { session } = await createTestSession({ stream: model, history })
  // oxlint-disable-next-line no-restricted-properties -- Measure real clone work without replacing the copy or isolation behavior.
  const clone = globalThis.structuredClone
  let copiedMessages = 0
  const measured = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    if (value && typeof value === 'object') {
      if ('messages' in value && Array.isArray(value.messages)) copiedMessages += value.messages.length
      if ('type' in value && value.type === 'message.upsert') copiedMessages++
    }
    return clone(value, options)
  })
  let projection: PiProjection
  try {
    projection = new PiProjection(
      { backendId: runtimeId('backend'), id: runtimeId('thread') },
      session,
      (error) => {
        throw error
      },
      false
    )
    expect(copiedMessages).toBeLessThanOrEqual(history.length * 2)
  } finally {
    measured.mockRestore()
  }
  expect(projection.feed.snapshot.messages.map((message) => message.parts)).toEqual(
    history.map((message) => [
      { type: 'text', text: message.content[0].type === 'text' ? message.content[0].text : '', state: 'done' }
    ])
  )
  await projection.close()
})

it('captures queued native text blocks at arrival without copying the full native event', async () => {
  const { model } = scriptedModel([
    assistantReply([
      { type: 'text', text: 'first block' },
      { type: 'text', text: 'second block' }
    ])
  ])
  const { session } = await createTestSession({ stream: model })
  const errors: unknown[] = []
  const projection = new PiProjection(
    { backendId: runtimeId('backend'), id: runtimeId('thread') },
    session,
    (error) => errors.push(error),
    false
  )
  // oxlint-disable-next-line no-restricted-properties -- Measure real clone work without replacing the copy or isolation behavior.
  const clone = globalThis.structuredClone
  let copiedNativeUpdates = 0
  const measured = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'message_update') copiedNativeUpdates++
    return clone(value, options)
  })
  try {
    await session.prompt('reply')
    await projection.close()
  } finally {
    measured.mockRestore()
  }
  expect(errors).toEqual([])
  expect(copiedNativeUpdates).toBe(0)
  expect(projection.feed.snapshot.messages.at(-1)?.parts).toEqual([
    { type: 'text', text: 'first block', state: 'done' },
    { type: 'text', text: 'second block', state: 'done' }
  ])
})
