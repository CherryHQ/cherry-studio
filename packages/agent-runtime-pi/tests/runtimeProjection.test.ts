import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { PiProjection } from '../src/runtimeProjection'
import { assistantReply, createTestSession, scriptedModel } from './sessionSupport'

const ref = { backendId: runtimeId<'backend'>('backend'), id: runtimeId<'thread'>('thread') }

it('restores committed history into the initial snapshot', async () => {
  const history = Array.from({ length: 32 }, (_, index) => assistantReply(`saved-${index}`))
  const { model } = scriptedModel([assistantReply('unused')])
  const { session } = await createTestSession({ stream: model, history })
  const projection = new PiProjection(
    ref,
    session,
    (error) => {
      throw error
    },
    false
  )
  expect(projection.feed.snapshot.messages.map((message) => message.parts)).toEqual(
    history.map((message) => [
      { type: 'text', text: message.content[0].type === 'text' ? message.content[0].text : '', state: 'done' }
    ])
  )
  await projection.close()
})

it('captures queued native text blocks at arrival', async () => {
  const { model } = scriptedModel([
    assistantReply([
      { type: 'text', text: 'first block' },
      { type: 'text', text: 'second block' }
    ])
  ])
  const { session } = await createTestSession({ stream: model })
  const errors: unknown[] = []
  const projection = new PiProjection(ref, session, (error) => errors.push(error), false)
  await session.prompt('reply')
  await projection.close()
  expect(errors).toEqual([])
  expect(projection.feed.snapshot.messages.at(-1)?.parts).toEqual([
    { type: 'text', text: 'first block', state: 'done' },
    { type: 'text', text: 'second block', state: 'done' }
  ])
})

it('projects a native fact as emitted when the native object changes before queued projection runs', async () => {
  const { model } = scriptedModel([assistantReply('original reply')])
  const { session } = await createTestSession({ stream: model })
  const errors: unknown[] = []
  const projection = new PiProjection(ref, session, (error) => errors.push(error), false)
  session.subscribe((event) => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return
    const part = event.message.content[0]
    if (part?.type === 'text') part.text = 'changed after emission'
  })
  await session.prompt('reply')
  await projection.close()
  expect(errors).toEqual([])
  expect(projection.feed.snapshot.messages.at(-1)?.parts).toEqual([
    { type: 'text', text: 'original reply', state: 'done' }
  ])
})
