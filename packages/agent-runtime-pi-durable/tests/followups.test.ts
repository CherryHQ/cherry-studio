import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { createRegistry, Harness, InboxDoc } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime } from '../src'
import { changeFollowups, readFollowups } from '../src/followups'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

it('preserves queued IDs across edit, reorder and restart, and only withdraws waiting inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-followups-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'session.sqlite')
  const context = BACKGROUND_CONTEXT
  const models = createModels()
  const faux = fauxProvider()
  models.setProvider(faux.provider)
  const options = { models, registry: createRegistry() }
  const harness = await Harness.open(await openNodeSqliteStorage(file), options, context)
  onTestFinished(() => harness.close(context))
  const conversation = await harness.createConversation(
    { ownership: { kind: 'ownerless' }, agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
    context
  )
  let notifyStarted!: () => void
  const started = new Promise<void>((resolve) => (notifyStarted = resolve))
  faux.setResponses([
    (_modelContext, call) =>
      new Promise((_, reject) => {
        notifyStarted()
        const signal = call!.signal!
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
  ])
  const active = await conversation.submit({ type: 'input', content: 'Active', whenBusy: 'reject' }, context)
  await started
  const submit = (text: string) =>
    conversation.submit(
      {
        type: 'input',
        content: text,
        whenBusy: 'followUp',
        requestId: text,
        entry: { kind: 'cherry.user-input', data: { cherryInputId: text } }
      },
      context
    )
  const first = await submit('First')
  const second = await submit('Second')
  const removed = await submit('Removed')
  const mutate = (change: Parameters<typeof changeFollowups>[2]) =>
    changeFollowups(harness, conversation.id, change, context)
  const order = ['First', 'Second', 'Removed']
  expect(await mutate({ type: 'withdraw', inputId: 'Removed' })).toBe(true)
  expect(await removed.status(context)).toMatchObject({ status: 'unanswered', reason: 'aborted' })
  expect(await active.status(context)).toMatchObject({ status: 'placed' })
  expect(await mutate({ type: 'reorder', before: order, after: [...order].reverse() })).toBe(false)
  expect(await mutate({ type: 'reorder', before: ['First', 'Second'], after: ['Second', 'First'] })).toBe(true)
  const change = { type: 'edit', inputId: 'Second', revision: 0, content: 'Edited second', textPart: 'edited' } as const
  expect(await mutate(change)).toBe(true)
  expect(await mutate({ ...change, content: 'Stale edit' })).toBe(false)
  await harness.close(context)

  const resumed = await Harness.open(await openNodeSqliteStorage(file), options, context)
  onTestFinished(() => resumed.close(context))
  const read = () => resumed.commit(async (tx) => readFollowups(await tx.doc(InboxDoc, conversation.id)), context)
  expect(await read()).toEqual([
    { inputId: 'Second', submissionId: second.id, revision: 1, textPart: 'edited' },
    { inputId: 'First', submissionId: first.id, revision: 0 }
  ])
  const inputs: unknown[] = []
  faux.setResponses(
    Array.from({ length: 5 }, () => (prompt) => {
      inputs.push(prompt.messages.findLast((message) => message.role === 'user')?.content)
      return fauxAssistantMessage('Answer')
    })
  )
  resumed.resume()
  await expect.poll(() => inputs).toEqual(['Active', 'Edited second', 'First'])
  await expect.poll(read).toEqual([])
  expect(await changeFollowups(resumed, conversation.id, { ...change, revision: 1 }, context)).toBe(false)
  expect(await changeFollowups(resumed, conversation.id, { type: 'withdraw', inputId: 'First' }, context)).toBe(false)
})

it.each([false, true])(
  'publishes admissions and doc-only edits to a live queue observer (staged: %s)',
  async (staged) => {
    const directory = await mkdtemp(join(tmpdir(), 'durable-followup-observer-'))
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const models = createModels()
    const faux = fauxProvider()
    models.setProvider(faux.provider)
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => (notifyStarted = resolve))
    faux.setResponses([
      (_modelContext, call) =>
        new Promise((_, reject) => {
          notifyStarted()
          const signal = call!.signal!
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    ])
    const observed: { inputId: string; revision: number }[][] = []
    const runtime = confirmed(
      await createPiDurableRuntime({
        backendId: runtimeId('followup-observer'),
        openStorage: () => openNodeSqliteStorage(join(directory, 'session.sqlite')),
        harness: { models, registry: createRegistry() },
        onFollowupsChanged: (_thread, queue) =>
          observed.push(queue.map(({ inputId, revision }) => ({ inputId, revision })))
      })
    )
    onTestFinished(async () => {
      await runtime.shutdown()
    })
    const queuedCommitDocuments: string[][] = []
    const commits = runtime.durable.observeCommits({
      advance({ changes }) {
        if (
          changes.some(
            (change) =>
              change.type === 'submission' && change.value.status === 'queued' && change.value.requestId === 'Next'
          )
        ) {
          queuedCommitDocuments.push(
            changes.flatMap((change) => (change.type === 'document' ? [change.record.kind] : []))
          )
        }
      },
      end() {}
    })
    onTestFinished(() => commits.detach())
    const driver = confirmed(
      await runtime.create({
        ownership: { kind: 'ownerless' },
        agent: { model: { provider: 'faux', modelId: 'faux-1' } }
      })
    )
    confirmed(await runtime.resume())
    await driver.input.submit!({ inputId: runtimeId('Active'), text: 'Active' })
    await started
    const next = { inputId: runtimeId<'input'>('Next'), text: 'Next' }
    const submitted = staged ? driver.durable.submitStagedFollowup(next) : driver.input.followUp!.submit(next)
    await expect(submitted).resolves.toMatchObject({ status: 'acknowledged', facts: ['accepted', 'queued'] })
    expect(queuedCommitDocuments).toHaveLength(1)
    expect(queuedCommitDocuments[0].includes('cherry.recovery')).toBe(staged)
    expect(observed.at(-1)).toEqual([{ inputId: 'Next', revision: 0 }])
    expect(
      await driver.durable.changeFollowups({
        type: 'edit',
        inputId: 'Next',
        revision: 0,
        content: 'Edited next',
        textPart: 'edited'
      })
    ).toBe(true)
    expect(observed.at(-1)).toEqual([{ inputId: 'Next', revision: 1 }])
    const original = driver.durable.followups()[0]
    const steer = {
      type: 'steer',
      inputId: 'Next',
      activeInputId: 'Active',
      replyId: 'active-reply'
    } as const
    expect(await driver.durable.changeFollowups({ ...steer, activeInputId: 'stale' })).toBe(false)
    expect(await driver.durable.changeFollowups(steer)).toBe(true)
    expect(await driver.durable.changeFollowups(steer)).toBe(false)
    expect(driver.durable.followups()).toEqual([{ ...original, steering: true }])
    await runtime.shutdown()
    const reopened = confirmed(
      await createPiDurableRuntime({
        backendId: driver.thread.backendId,
        openStorage: () => openNodeSqliteStorage(join(directory, 'session.sqlite')),
        harness: { models, registry: createRegistry() }
      })
    )
    onTestFinished(async () => {
      await reopened.shutdown()
    })
    expect(confirmed(await reopened.open(driver.thread)).durable.followups()).toEqual([{ ...original, steering: true }])
  }
)
