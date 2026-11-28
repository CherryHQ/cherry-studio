import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, type TranscriptContext } from '@earendil-works/pi-ai'
import { createRegistry, Harness, InboxDoc, pauseFollowUpsForStop, type Submission } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiDurableRuntime } from '../src'
import { changeFollowups, followupEdit, readFollowups } from '../src/followups'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

const hold = { owner: 'window', token: 'editor' }
const beginEdit = (inputId: string) => ({
  type: 'begin-edit' as const,
  inputId,
  revision: 0,
  hold,
  isOwnerLive: (owner: string) => owner === hold.owner
})

it('reads the persisted text-only edit from an older inbox', () => {
  const textPart = JSON.stringify({ type: 'text', text: 'First edit' })
  expect(followupEdit({ queueEdit: { revision: 2, textPart } })).toEqual({ revision: 2, textPart })
})

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
  const mutate = (change: Parameters<typeof changeFollowups>[1]) => changeFollowups(conversation, change, context)
  const order = ['First', 'Second', 'Removed']
  expect(await mutate({ type: 'withdraw', inputId: 'Removed' })).toBe(true)
  expect(await removed.status(context)).toMatchObject({ status: 'unanswered', reason: 'withdrawn' })
  expect(await active.status(context)).toMatchObject({ status: 'placed' })
  expect(await mutate({ type: 'reorder', before: order, after: [...order].reverse() })).toBe(false)
  expect(await mutate({ type: 'reorder', before: ['First', 'Second'], after: ['Second', 'First'] })).toBe(true)
  const change = {
    type: 'edit',
    inputId: 'Second',
    revision: 0,
    hold,
    content: 'Edited second',
    parts: '[{"type":"text","text":"edited"}]'
  } as const
  expect(await mutate(beginEdit('Second'))).toBe(true)
  expect(await mutate(change)).toBe(true)
  expect(await mutate({ ...change, content: 'Stale edit' })).toBe(false)
  await harness.close(context)

  const resumed = await Harness.open(await openNodeSqliteStorage(file), options, context)
  onTestFinished(() => resumed.close(context))
  const reopened = (await resumed.conversation(conversation.id, context))!
  const read = () => resumed.commit(async (tx) => readFollowups(await tx.doc(InboxDoc, conversation.id)), context)
  expect(await read()).toEqual([
    { inputId: 'Second', submissionId: second.id, revision: 1, parts: '[{"type":"text","text":"edited"}]' },
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
  expect(await changeFollowups(reopened, { ...change, revision: 1 }, context)).toBe(false)
  expect(await changeFollowups(reopened, { type: 'withdraw', inputId: 'First' }, context)).toBe(false)
})

it.each(['stop', 'error'] as const)(
  'keeps the edited item and later inputs queued across %s and reopen',
  async (stopReason) => {
    const directory = await mkdtemp(join(tmpdir(), 'durable-edit-hold-'))
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
    let finishUpstream!: (message: ReturnType<typeof fauxAssistantMessage>) => void
    const upstream = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => (finishUpstream = resolve))
    const prompts: unknown[] = []
    faux.setResponses([
      () => upstream,
      ...Array.from({ length: 3 }, () => (prompt: TranscriptContext) => {
        prompts.push(prompt.messages.findLast((message) => message.role === 'user')?.content)
        return fauxAssistantMessage('Answer')
      })
    ])
    await conversation.submit({ type: 'input', content: 'Active' }, context)
    const mutate = (change: Parameters<typeof changeFollowups>[1]) => changeFollowups(conversation, change, context)
    const replacement = { owner: 'reopened window', token: 'new token' }
    const reclaim = { ...beginEdit('Original'), hold: replacement }
    const submitted: Submission[] = []
    try {
      for (const text of ['Before', 'Original', 'After']) {
        submitted.push(
          await conversation.submit(
            {
              type: 'input',
              content: text,
              whenBusy: 'followUp',
              entry: { kind: 'cherry.user-input', data: { cherryInputId: text } }
            },
            context
          )
        )
      }
      expect(await mutate(beginEdit('Original'))).toBe(true)
      expect(await mutate({ ...reclaim, isOwnerLive: () => true })).toBe(false)
    } finally {
      finishUpstream(fauxAssistantMessage('Upstream', { stopReason, errorMessage: 'provider failed' }))
    }
    await conversation.waitForIdle(context)
    expect(prompts).toEqual(stopReason === 'stop' ? ['Before'] : [])
    expect(await submitted[1].status(context)).toMatchObject({ status: 'queued' })
    expect(await submitted[2].status(context)).toMatchObject({ status: 'queued' })
    await harness.close(context)

    const reopened = await Harness.open(await openNodeSqliteStorage(file), options, context)
    onTestFinished(() => reopened.close(context))
    const recovered = (await reopened.conversation(conversation.id, context))!
    const read = (id: (typeof submitted)[number]['id']) => reopened.commit((tx) => tx.submission(id), context)
    const queue = () => reopened.commit(async (tx) => readFollowups(await tx.doc(InboxDoc, recovered.id)), context)
    expect((await queue()).find(({ inputId }) => inputId === 'Original')).toMatchObject({ editing: true })
    expect(
      await changeFollowups(recovered, { ...reclaim, isOwnerLive: (id) => id === replacement.owner }, context)
    ).toBe(true)
    expect(await changeFollowups(recovered, { type: 'cancel-edit', inputId: 'Original', hold }, context)).toBe(false)
    const save = {
      type: 'edit',
      inputId: 'Original',
      revision: 0,
      hold: replacement,
      content: 'Edited',
      parts: '[{"type":"text","text":"Edited"}]'
    } as const
    expect(await changeFollowups(recovered, save, context)).toBe(true)
    expect(await changeFollowups(recovered, save, context)).toBe(false)
    await recovered.waitForIdle(context)
    expect(prompts).toEqual(stopReason === 'stop' ? ['Before', 'Edited', 'After'] : [])
    expect(await read(submitted[1].id)).toMatchObject({ status: stopReason === 'stop' ? 'done' : 'queued' })
    expect(await read(submitted[2].id)).toMatchObject({ status: stopReason === 'stop' ? 'done' : 'queued' })
  }
)

it('recovers a committed stop and its paused inbox without a second abort call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'durable-stop-'))
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
    (_prompt, call) =>
      new Promise((_, reject) => {
        notifyStarted()
        const signal = call!.signal!
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
  ])
  const active = await conversation.submit({ type: 'input', content: 'Active' }, context)
  await started
  const queued = await conversation.submit(
    {
      type: 'input',
      content: 'Queued',
      whenBusy: 'followUp',
      entry: { kind: 'cherry.user-input', data: { cherryInputId: 'Queued' } }
    },
    context
  )
  expect(await changeFollowups(conversation, beginEdit('Queued'), context)).toBe(true)
  await harness.commit((tx) => pauseFollowUpsForStop(tx, conversation.id), context)
  await harness.close(context)

  const resumed = await Harness.open(await openNodeSqliteStorage(file), options, context)
  onTestFinished(() => resumed.close(context))
  const reopened = (await resumed.conversation(conversation.id, context))!
  const prompts: unknown[] = []
  faux.setResponses([
    (prompt) => {
      prompts.push(prompt.messages.findLast((message) => message.role === 'user')?.content)
      return fauxAssistantMessage('Answer')
    }
  ])
  await reopened.waitForIdle(context)
  const submission = (id: typeof active.id) => resumed.commit((tx) => tx.submission(id), context)
  expect(await submission(active.id)).toMatchObject({ status: 'unanswered', reason: 'aborted' })
  expect(await submission(queued.id)).toMatchObject({ status: 'queued' })
  expect(prompts).toEqual([])

  expect(await reopened.resumeFollowUps(context)).toBe(true)
  expect(await reopened.resumeFollowUps(context)).toBe(false)
  await reopened.waitForIdle(context)
  expect(await submission(queued.id)).toMatchObject({ status: 'queued' })
  expect(prompts).toEqual([])
  expect(await changeFollowups(reopened, { type: 'cancel-edit', inputId: 'Queued', hold }, context)).toBe(true)
  await reopened.waitForIdle(context)
  expect(await submission(queued.id)).toMatchObject({ status: 'done' })
  expect(prompts).toEqual(['Queued'])
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
    expect(await driver.durable.changeFollowups(beginEdit('Next'))).toBe(true)
    expect(
      await driver.durable.changeFollowups({
        type: 'edit',
        inputId: 'Next',
        revision: 0,
        hold,
        content: 'Edited next',
        parts: '[{"type":"text","text":"edited"}]'
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
