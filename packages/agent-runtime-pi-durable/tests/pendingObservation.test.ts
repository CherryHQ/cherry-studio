import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, type FauxResponseStep } from '@earendil-works/pi-ai'
import { Harness, InboxDoc, createRegistry } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

const metadataCases = [false, true].flatMap((resume) =>
  [
    { kind: 'unmarked', data: undefined, logicalId: undefined },
    { kind: 'nonstring', data: { cherryInputId: 42 }, logicalId: undefined },
    { kind: 'array', data: [{ cherryInputId: 'nested-only' }], logicalId: undefined },
    { kind: 'marked', data: { cherryInputId: 'external-input' }, logicalId: 'external-input' }
  ].map((item) => ({ ...item, resume }))
)

it.each(metadataCases)('restores $kind inputs (resume=$resume)', async ({ resume, data, logicalId }) => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-pending-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.sqlite')
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  const options = { models, registry: createRegistry() }
  const context = BACKGROUND_CONTEXT
  const native = await Harness.open(await openNodeSqliteStorage(path), options, context)
  onTestFinished(() => native.close(context))
  const conversation = await native.createConversation(
    {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    },
    context
  )
  let started!: () => void
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const hold: FauxResponseStep = (_context, call) =>
    new Promise((_, reject) => {
      started()
      const signal = call!.signal!
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  faux.setResponses([hold])
  const active = await conversation.submit(
    { type: 'input', content: 'Start', whenBusy: 'reject', entry: { kind: 'external.input', data } },
    context
  )
  await reached
  const first = await conversation.submit({ type: 'input', content: 'First queued', whenBusy: 'followUp' }, context)
  const second = await conversation.submit({ type: 'input', content: 'Second queued', whenBusy: 'followUp' }, context)
  await conversation.submit({ type: 'write', entry: { kind: 'state', model: [] } }, context)
  expect(
    await native.commit(async (tx) => (await tx.doc(InboxDoc, conversation.id)).items.map((item) => item.mode), context)
  ).toEqual(['followUp', 'followUp', 'write'])
  await native.close(context)

  const before = faux.state.callCount
  faux.setResponses([
    fauxAssistantMessage('Resumed'),
    fauxAssistantMessage('Follow-up answer'),
    fauxAssistantMessage('Last answer')
  ])
  const runtime = confirmed(
    await createPiDurableRuntime({
      backendId: runtimeId('pending'),
      openStorage: () => openNodeSqliteStorage(path),
      harness: options
    })
  )
  onTestFinished(async () => {
    await runtime.shutdown()
  })
  const thread = { backendId: runtimeId<'backend'>('pending'), id: runtimeId<'thread'>(String(conversation.id)) }
  const opening = runtime.open(thread)
  if (resume) confirmed(await runtime.resume())
  const handle = confirmed(await opening)
  const events: ObservationPayload[] = []
  confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  await expect.poll(() => events[0]).toMatchObject({ type: 'snapshot' })
  const snapshot = events[0]
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  if (!resume) {
    expect(snapshot.inputs).toEqual([
      {
        nativeInput: { session: thread, id: String(active.id) },
        facts: ['accepted', 'placed'],
        ...(logicalId && { inputId: logicalId })
      },
      ...[first, second].map((submission) => ({
        nativeInput: { session: thread, id: String(submission.id) },
        facts: ['accepted', 'queued']
      }))
    ])
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(faux.state.callCount).toBe(before)
    confirmed(await runtime.resume())
  }
  const observed = (id: number) =>
    events
      .flatMap((event) =>
        event.type === 'snapshot' ? event.inputs : event.type === 'input.changed' ? [event.input] : []
      )
      .filter((input) => input.nativeInput?.id === String(id))
  for (const submission of [first, second]) {
    await expect.poll(() => observed(submission.id).at(-1)).toMatchObject({ outcome: 'completed' })
    const states = observed(submission.id)
    const placed = states.findIndex((input) => input.facts.includes('placed'))
    expect(placed).toBeGreaterThanOrEqual(0)
    expect(states.slice(placed).every((input) => !input.facts.includes('queued'))).toBe(true)
  }
  expect(observed(active.id).length).toBeGreaterThan(0)
  expect(observed(active.id).every((input) => input.inputId === logicalId)).toBe(true)
  const archive = confirmed(await handle.archive())
  const startingMessage = archive.messages.find(
    (message) => message.role === 'user' && message.parts.some((part) => part.type === 'text' && part.text === 'Start')
  )
  expect(startingMessage).toBeDefined()
  expect(startingMessage?.metadata?.inputId).toBe(logicalId)
})
