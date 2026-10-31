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

it.each([false, true])('discovers persisted pending inputs on reopen (concurrent resume: %s)', async (resume) => {
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
  await conversation.submit({ type: 'input', content: 'Start', whenBusy: 'reject' }, context)
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
  await expect.poll(() => events[0]).toMatchObject({ type: 'snapshot', coverage: 'current-view' })
  const snapshot = events[0]
  if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
  if (!resume) {
    expect(snapshot.inputs).toEqual(
      [first, second].map((submission) => ({
        nativeInput: { session: thread, id: String(submission.id) },
        facts: ['accepted', 'queued']
      }))
    )
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
})
