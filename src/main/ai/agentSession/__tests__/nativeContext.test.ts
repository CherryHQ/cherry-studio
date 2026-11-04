import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { createRegistry } from '@earendil-works/pi-durable'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { NodeSqliteDatabase, openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import {
  runtimeId,
  type OperationResult,
  type Thread,
  type ThreadHandle,
  type InputState,
  type BusyPolicy
} from '@cherrystudio/agent-runtime'
import { createPiRuntime, type AgentRuntimeSessionOptions, type PiRuntime } from '@cherrystudio/agent-runtime-pi'
import {
  createPiDurableRuntime,
  type PiDurableRuntime,
  type PiDurableRuntimeOptions
} from '@cherrystudio/agent-runtime-pi-durable'
import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentSessionContextSeeder } from '@data/db/seeding/seeders/AgentSessionContextSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { allocateDurableBackendTx, prepareDurableBranch } from '@main/ai/runtime/piDurable/durableContext'

import {
  reconcileDurableBackend,
  createDurableBackend as initializeDurableBackend,
  openDurableStorage,
  prepareDurableRoot
} from '../durableNativeContext'
import { applyNativeSubmissionResult, bindNativeInput, prepareNativeSubmission } from '../nativeSubmission'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

function loadPiSession(backendId: string, nativeId: string, cwd?: string): SessionManager {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeId)) throw new Error('Invalid Pi session identity')
  const directory = application.getPath('feature.agents.pi.sessions')
  const files = readdirSync(directory).filter((file) => file.endsWith(`_${nativeId}.jsonl`))
  if (files.length !== 1) throw new Error('Pi session is missing or ambiguous')
  const file = application.getPath('feature.agents.pi.sessions', files[0])
  if (!lstatSync(file).isFile()) throw new Error('Pi session must be a regular file')
  return SessionManager.openExisting(file, nativeId, cwd)
}

async function createDurableBackend() {
  const backend = application.get('DbService').withWriteTx(allocateDurableBackendTx)
  return initializeDurableBackend(backend.id)
}

async function openDurableBackend(backendId: string, harness: PiDurableRuntimeOptions['harness']) {
  const storage = await reconcileDurableBackend(backendId)
  return createPiDurableRuntime({
    backendId: runtimeId(backendId),
    openStorage: async () => storage,
    harness
  })
}

function allocatePiBackend() {
  return application
    .get('DbService')
    .withWriteTx((tx) => contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound'))
}

function openPiBackend(backendId: string, loadOptions: (thread: Thread) => Promise<AgentRuntimeSessionOptions>) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  return createPiRuntime({
    backendId: runtimeId(backendId),
    load: async (thread) => {
      const sessionManager = loadPiSession(backendId, thread.id)
      return { ...(await loadOptions(thread)), sessionManager }
    }
  })
}

async function createPiContext(
  sessionId: string,
  backendId: string,
  runtime: PiRuntime,
  options: AgentRuntimeSessionOptions
) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  const intent = contexts.allocateContext(sessionId, backendId, uuid())
  const sessionManager = SessionManager.create(options.cwd, application.getPath('feature.agents.pi.sessions'), {
    id: intent.nativeThreadId!
  })
  const result = await runtime.create({ ...options, sessionManager })
  if (
    result.status === 'confirmed' &&
    (result.value.thread.backendId !== backendId || result.value.thread.id !== intent.nativeThreadId)
  )
    throw new Error('Created Pi identity does not match the intent')
  return { context: intent, result }
}

function confirmPiContext(contextId: string) {
  const context = contexts.context(contextId)
  if (!context.nativeThreadId) throw new Error('Pi context has no native identity')
  loadPiSession(context.backendId, context.nativeThreadId)
  return contexts.bindContext(context.id, context.nativeThreadId)
}

async function createDurableContext(
  sessionId: string,
  backendId: string,
  runtime: PiDurableRuntime,
  options: Parameters<PiDurableRuntime['create']>[0]
) {
  if (contexts.backend(backendId).locator.kind !== 'pi-durable') throw new Error('Backend is not Pi Durable')
  const intent = contexts.allocateContext(sessionId, backendId)
  const result = await runtime.create(options)
  if (result.status === 'confirmed' && result.value.thread.backendId !== backendId) {
    throw new Error('Created Durable backend does not match the intent')
  }
  const context = result.status === 'confirmed' ? contexts.bindContext(intent.id, result.value.thread.id) : intent
  return { context, result }
}

async function openNativeContext(
  contextId: string,
  runtime: PiRuntime | PiDurableRuntime
): Promise<OperationResult<ThreadHandle>> {
  const context = contexts.context(contextId)
  if (context.bindingState !== 'bound' || !context.nativeThreadId) throw new Error('Native context is unbound')
  return runtime.open({ backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) })
}

// Exercise real adapters and native storage: receipt-only mocks cannot prove reattachment or deduplication.
describe('native context storage and reconciliation', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let sessionId: string
  const cleanup: Array<() => Promise<unknown>> = []

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-native-context-'))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const path = join(directory, key)
      return file ? join(path, file) : path
    })
    sessionId = uuid()
    const workspaceId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Native', orderKey: 'a0' }).run()
  })
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!()
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })
  function message(text = 'question') {
    const id = uuid()
    messages.saveMessage({ sessionId, message: { id, role: 'user', data: { parts: [{ type: 'text', text }] } } })
    return id
  }
  async function observeInputs(handle: ThreadHandle, contextId: string) {
    const inputs = new Map<string, InputState>()
    const observation = confirmed(
      await handle.observe((event) => {
        const changed = event.type === 'snapshot' ? event.inputs : event.type === 'input.changed' ? [event.input] : []
        for (const input of changed) {
          const messageId = bindNativeInput(sessionId, contextId, input)
          if (messageId) inputs.set(messageId, input)
        }
      })
    )
    return { inputs, stop: () => observation.stop() }
  }
  async function submitInput(handle: ThreadHandle, id: string, contextId: string, whenBusy: BusyPolicy = 'reject') {
    const draft = prepareNativeSubmission(sessionId, id, contextId, whenBusy)
    const input = { ...draft, deduplicationKey: id }
    const result = await handle.input!.submit(input)
    applyNativeSubmissionResult(sessionId, contextId, result)
    return result
  }
  async function pi() {
    const backend = allocatePiBackend()
    const faux = fauxProvider({ tokensPerSecond: 10000 })
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    modelRuntime.registerNativeProvider(faux.provider)
    const options = {
      cwd: directory,
      agentDir: directory,
      modelRuntime,
      model: modelRuntime.getModel('faux', 'faux-1')!
    }
    const runtime = confirmed(await openPiBackend(backend.id, async () => options))
    cleanup.push(() => runtime.shutdown())
    return { backend, runtime, options, faux }
  }
  async function durable() {
    const backend = await createDurableBackend()
    const faux = fauxProvider({ tokensPerSecond: 10000 })
    const models = createModels()
    models.setProvider(faux.provider)
    const options = { models, registry: createRegistry() }
    const runtime = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => runtime.shutdown())
    return { backend, runtime, options, faux }
  }

  it('reserves one Durable branch without opening storage or permitting another harness to reuse it', () => {
    const intent = prepareDurableBranch(sessionId)
    const backend = contexts.backend(intent.backendId)
    if (backend.locator.kind !== 'pi-durable') throw new Error('Expected Durable backend')
    expect(backend.state).toBe('creating')
    expect(existsSync(application.getPath('feature.agents.durable.stores', backend.locator.fileName))).toBe(false)
    expect(prepareDurableBranch(sessionId).id).toBe(intent.id)
    expect(() => preparePiBranch(sessionId)).toThrow('another runtime')
    expect(contexts.forSession(sessionId).map((context) => context.id)).toEqual([intent.id])
    expect(
      dbh.db
        .select()
        .from(agentRuntimeBackendTable)
        .all()
        .map((row) => row.id)
    ).toEqual([backend.id])
  })

  it.each([false, true])(
    'recovers the Durable root before confirmation with a reserved identity: %s',
    async (reserved) => {
      const intent = prepareDurableBranch(sessionId)
      const root = await prepareDurableRoot(intent.id)
      const { createPiDurableRuntime } = await import('@cherrystudio/agent-runtime-pi-durable')
      const runtime = confirmed(
        await createPiDurableRuntime({
          backendId: runtimeId(intent.backendId),
          openStorage: async () => root.storage,
          harness: { models: createModels(), registry: createRegistry() }
        })
      )
      cleanup.push(() => runtime.shutdown())
      const handle = confirmed(await runtime.create({ ownership: { kind: 'ownerless' }, init: root.init }))
      if (reserved)
        dbh.db
          .update(agentSessionContextTable)
          .set({ nativeThreadId: handle.thread.id })
          .where(eq(agentSessionContextTable.id, intent.id))
          .run()
      expect(contexts.context(intent.id).bindingState).toBe('pending')
      await runtime.shutdown()
      const recovered = await prepareDurableRoot(intent.id)
      try {
        expect(recovered.nativeId).toBe(handle.thread.id)
        expect(contexts.context(intent.id)).toMatchObject({ nativeThreadId: handle.thread.id, bindingState: 'bound' })
        expect((await recovered.storage.scanConversations({}, 100, undefined, BACKGROUND_CONTEXT)).items).toHaveLength(
          1
        )
      } finally {
        await recovered.storage.close(BACKGROUND_CONTEXT)
      }
    }
  )

  it.each(['schema', 'identity'] as const)(
    'retries a Durable %s initialization failure on the same branch',
    async (stage) => {
      const intent = prepareDurableBranch(sessionId)
      const backend = contexts.backend(intent.backendId)
      if (backend.locator.kind !== 'pi-durable') throw new Error('Expected Durable backend')
      const failure = new Error('native initialization failed')
      const fault =
        stage === 'schema'
          ? vi.spyOn(NodeSqliteDatabase.prototype, 'exec').mockRejectedValueOnce(failure)
          : vi.spyOn(SqliteStorage.prototype, 'commit').mockRejectedValueOnce(failure)

      await expect(prepareDurableRoot(intent.id)).rejects.toThrow(failure)
      fault.mockRestore()
      expect(contexts.backend(backend.id).state).toBe('creating')
      expect(prepareDurableBranch(sessionId).id).toBe(intent.id)

      const root = await prepareDurableRoot(intent.id)
      try {
        expect(contexts.backend(backend.id).state).toBe('bound')
        expect((await root.storage.scanConversations({}, 10, undefined, BACKGROUND_CONTEXT)).items).toEqual([])
      } finally {
        await root.storage.close(BACKGROUND_CONTEXT)
      }
      const reopened = await openDurableStorage(contexts.backend(backend.id))
      await reopened.close(BACKGROUND_CONTEXT)
    }
  )

  it.each(['empty', 'unmarked', 'foreign'] as const)(
    'does not replace a %s store during Durable creation retry',
    async (kind) => {
      const intent = prepareDurableBranch(sessionId)
      const backend = contexts.backend(intent.backendId)
      if (backend.locator.kind !== 'pi-durable') throw new Error('Expected Durable backend')
      const path = application.getPath('feature.agents.durable.stores', backend.locator.fileName)
      mkdirSync(application.getPath('feature.agents.durable.stores'), { recursive: true })
      if (kind === 'empty') writeFileSync(path, '')
      else if (kind === 'unmarked') {
        const storage = await openNodeSqliteStorage(path)
        await storage.close(BACKGROUND_CONTEXT)
      } else {
        const other = await createDurableBackend()
        if (other.locator.kind !== 'pi-durable') throw new Error('Expected Durable backend')
        copyFileSync(application.getPath('feature.agents.durable.stores', other.locator.fileName), path)
      }
      const before = readFileSync(path)
      await expect(prepareDurableRoot(intent.id)).rejects.toThrow()
      expect(readFileSync(path)).toEqual(before)
      expect(contexts.backend(backend.id).state).toBe('creating')
      expect(contexts.context(intent.id).bindingState).toBe('pending')
    }
  )

  it('keeps an unflushed Pi context unresolved, then strictly restores its original native history', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const handle = confirmed(created.result)
    expect(() => confirmPiContext(created.context.id)).toThrow('missing')
    const observer = await observeInputs(handle, created.context.id)
    cleanup.push(() => observer.stop())
    const inputId = message()
    faux.setResponses([fauxAssistantMessage('saved answer')])
    expect((await submitInput(handle, inputId, created.context.id)).status).toBe('acknowledged')
    await expect.poll(() => observer.inputs.get(inputId)?.outcome).toBe('completed')
    confirmPiContext(created.context.id)
    await observer.stop()
    await runtime.shutdown()
    const reopened = confirmed(await openPiBackend(backend.id, async () => options))
    cleanup.push(() => reopened.shutdown())
    const restored = confirmed(await openNativeContext(created.context.id, reopened))
    const text: string[] = []
    confirmed(
      await restored.observe((event) => {
        if (event.type === 'snapshot')
          for (const message of event.messages) {
            text.push(...message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
          }
      })
    )
    expect(text.join('\n')).toContain('saved answer')
  })

  it('refuses missing, empty, mismatched and ambiguous Pi files without initializing them', async () => {
    const { backend, options } = await pi()
    const manager = SessionManager.create(directory, application.getPath('feature.agents.pi.sessions'))
    const file = manager.getSessionFile()!
    expect(() => loadPiSession(backend.id, manager.getSessionId())).toThrow()
    expect(existsSync(file)).toBe(false)
    writeFileSync(file, '')
    expect(() => loadPiSession(backend.id, manager.getSessionId())).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('')
    rmSync(file)
    manager.appendMessage(fauxAssistantMessage('native history'))
    const source = readFileSync(file, 'utf8')
    writeFileSync(file, source.replace(manager.getSessionId(), 'another-id'))
    const wrong = readFileSync(file, 'utf8')
    expect(() => loadPiSession(backend.id, manager.getSessionId(), options.cwd)).toThrow('identity')
    expect(readFileSync(file, 'utf8')).toBe(wrong)
    writeFileSync(file, source)
    copyFileSync(file, application.getPath('feature.agents.pi.sessions', `duplicate_${manager.getSessionId()}.jsonl`))
    expect(() => loadPiSession(backend.id, manager.getSessionId())).toThrow('ambiguous')
  })

  it('confirms seeded identities separately and retries missing files after seeding is complete', async () => {
    const { backend } = await pi()
    const agentId = uuid()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Pi', instructions: '', orderKey: 'a0' }).run()
    dbh.db.update(agentSessionTable).set({ agentId }).where(eq(agentSessionTable.id, sessionId)).run()
    const manager = SessionManager.create(directory, application.getPath('feature.agents.pi.sessions'))
    manager.appendMessage(fauxAssistantMessage('old native answer'))
    const first = message('old visible question')
    const second = message('pending delivery')
    dbh.db
      .update(agentSessionMessageTable)
      .set({ runtimeResumeToken: manager.getSessionId() })
      .where(eq(agentSessionMessageTable.id, first))
      .run()
    dbh.db
      .update(agentSessionMessageTable)
      .set({ runtimeResumeToken: 'missing-native', deliveryStatus: 'accepted' })
      .where(eq(agentSessionMessageTable.id, second))
      .run()
    const before = dbh.db.select().from(agentSessionMessageTable).all()
    const files = readdirSync(application.getPath('feature.agents.pi.sessions'))
    const seeder = new AgentSessionContextSeeder()
    new SeedRunner(dbh.db).runAll([seeder])
    const pending = contexts.forSession(sessionId)
    expect(pending).toHaveLength(2)
    expect(pending.every((row) => row.bindingState === 'pending' && row.backendId === backend.id)).toBe(true)
    const available = pending.find((row) => row.nativeThreadId === manager.getSessionId())!
    const missing = pending.find((row) => row.nativeThreadId === 'missing-native')!
    expect(confirmPiContext(available.id).nativeThreadId).toBe(manager.getSessionId())
    expect(() => confirmPiContext(missing.id)).toThrow('missing')
    expect(contexts.context(missing.id).bindingState).toBe('pending')
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
    expect(readdirSync(application.getPath('feature.agents.pi.sessions'))).toEqual(files)

    const recovered = SessionManager.create(directory, application.getPath('feature.agents.pi.sessions'), {
      id: 'missing-native'
    })
    recovered.appendMessage(fauxAssistantMessage('recovered native history'))
    new SeedRunner(dbh.db).runAll([seeder])
    expect(contexts.context(missing.id).bindingState).toBe('pending')
    expect(confirmPiContext(missing.id).nativeThreadId).toBe('missing-native')
    expect(contexts.forSession(sessionId)).toHaveLength(2)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
  })

  it('does not dispatch when the message submission transaction fails', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const handle = confirmed(created.result)
    const observer = await observeInputs(handle, created.context.id)
    cleanup.push(() => observer.stop())
    const id = message()
    vi.spyOn(messages, 'bindInputContextTx').mockImplementationOnce(() => {
      throw new Error('DB write failed')
    })
    await expect(submitInput(handle, id, created.context.id)).rejects.toThrow('DB write failed')
    expect(faux.state.callCount).toBe(0)
    expect(messages.inputBinding(sessionId, id)).toBeUndefined()
  })

  it('leaves an unsupported draft editable without recording or dispatching a native submission', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const handle = confirmed(created.result)
    const observer = await observeInputs(handle, created.context.id)
    cleanup.push(() => observer.stop())
    const id = message()
    messages.updateSessionMessage(sessionId, id, { data: { parts: [] } })
    await expect(submitInput(handle, id, created.context.id)).rejects.toThrow('requires message content')
    expect(messages.inputBinding(sessionId, id)).toBeUndefined()
    expect(faux.state.callCount).toBe(0)
    messages.updateSessionMessage(sessionId, id, { data: { parts: [{ type: 'text', text: 'corrected' }] } })
    expect(messages.getSessionMessage(sessionId, id).data.parts).toEqual([{ type: 'text', text: 'corrected' }])
  })

  it('leaves a message editable after native admission explicitly rejects it', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const handle = confirmed(created.result)
    await handle.release()
    const id = message()

    expect((await submitInput(handle, id, created.context.id)).status).toBe('rejected')
    messages.updateSessionMessage(sessionId, id, { data: { parts: [{ type: 'text', text: 'corrected' }] } })
    expect(messages.getSessionMessage(sessionId, id).data.parts).toEqual([{ type: 'text', text: 'corrected' }])
    messages.deleteSessionMessage(sessionId, id)
    expect(() => messages.getSessionMessage(sessionId, id)).toThrow()
    expect(faux.state.callCount).toBe(0)
  })

  it('rejects a prepared payload if its retained message changed before submission', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const id = message('original')
    const parts = messages.getSessionMessage(sessionId, id).data.parts
    messages.updateSessionMessage(sessionId, id, { data: { parts: [{ type: 'text', text: 'edited' }] } })
    expect(() =>
      prepareNativeSubmission(sessionId, id, created.context.id, 'reject', { text: 'wrapped original', parts })
    ).toThrow('content changed')
    expect(messages.inputBinding(sessionId, id)).toBeUndefined()
    expect(faux.state.callCount).toBe(0)
    const draft = prepareNativeSubmission(sessionId, id, created.context.id, 'reject', {
      text: 'wrapped edited',
      parts: [{ type: 'text', text: 'edited' }]
    })
    expect(draft).toEqual({ inputId: id, text: 'wrapped edited', whenBusy: 'reject' })
  })

  it('restores Durable inputs by their original message key without scheduling work on reopen', async () => {
    const { backend, runtime, faux, options } = await durable()
    const created = await createDurableContext(sessionId, backend.id, runtime, {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
    const handle = confirmed(created.result)
    const observer = await observeInputs(handle, created.context.id)
    cleanup.push(() => observer.stop())
    faux.setResponses([fauxAssistantMessage('durable native answer')])
    const id = message()
    expect((await submitInput(handle, id, created.context.id)).status).toBe('acknowledged')
    await expect.poll(() => observer.inputs.get(id)?.outcome).toBe('completed')
    await observer.stop()
    await runtime.shutdown()
    const reopened = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => reopened.shutdown())
    const restored = confirmed(await reopened.open(handle.thread))
    const result = confirmed(await restored.lookupInput({ by: 'deduplication-key', key: id }))
    expect(result).toMatchObject({ found: true, input: { outcome: 'completed' } })
    const repeated = await restored.input.submit({
      inputId: runtimeId(id),
      text: 'question',
      whenBusy: 'reject',
      deduplicationKey: id
    })
    expect(repeated.status).toBe('acknowledged')
    expect(confirmed(await restored.lookupInput({ by: 'deduplication-key', key: id }))).toMatchObject(result)
    expect(confirmed(await restored.lookupInput({ by: 'deduplication-key', key: 'missing' }))).toEqual({ found: false })
    expect(faux.state.callCount).toBe(1)
  })

  it('leaves interrupted Durable work passive until explicit resume and reconciles the original input', async () => {
    const { backend, runtime, faux, options } = await durable()
    const reached = Promise.withResolvers<void>()
    faux.setResponses([
      (_context, stream) =>
        new Promise((_, reject) => {
          reached.resolve()
          const signal = stream!.signal!
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    ])
    const created = await createDurableContext(sessionId, backend.id, runtime, {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
    const handle = confirmed(created.result)
    const observer = await observeInputs(handle, created.context.id)
    const id = message()
    await submitInput(handle, id, created.context.id)
    await reached.promise
    await observer.stop()
    await runtime.shutdown()
    const before = faux.state.callCount
    faux.setResponses([fauxAssistantMessage('explicitly resumed')])
    const reopened = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => reopened.shutdown())
    const access = confirmed(await reopened.open(handle.thread))
    expect(confirmed(await access.lookupInput({ by: 'deduplication-key', key: id }))).toMatchObject({
      found: true,
      input: { facts: ['accepted', 'placed'] }
    })
    expect(observer.inputs.get(id)?.outcome).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(faux.state.callCount).toBe(before)
    confirmed(await reopened.resume())
    await expect
      .poll(async () => {
        const found = confirmed(await access.lookupInput({ by: 'deduplication-key', key: id }))
        return found.found ? found.input.outcome : undefined
      })
      .toBe('completed')
    expect(faux.state.callCount).toBe(before + 1)
  })

  it('recovers a queued Durable input by native identity before it has a transcript entry', async () => {
    const { backend, runtime, faux, options } = await durable()
    const reached = Promise.withResolvers<void>()
    faux.setResponses([
      (_context, stream) =>
        new Promise((_, reject) => {
          reached.resolve()
          const signal = stream!.signal!
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    ])
    const created = await createDurableContext(sessionId, backend.id, runtime, {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
    const handle = confirmed(created.result)
    await submitInput(handle, message('running'), created.context.id)
    await reached.promise
    const queuedId = message('queued')
    const receipt = await submitInput(handle, queuedId, created.context.id, 'follow-up')
    if (receipt.status !== 'acknowledged' || !receipt.nativeInput) throw new Error('Expected native queued receipt')
    expect(receipt.facts).toContain('queued')
    await runtime.shutdown()
    const before = faux.state.callCount
    const reopened = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => reopened.shutdown())
    const restored = confirmed(await reopened.open(handle.thread))
    const found = confirmed(await restored.lookupInput({ by: 'native-ref', ref: receipt.nativeInput }))
    if (!found.found) throw new Error('Queued native input was lost')
    expect(found.input.inputId).toBeUndefined()
    expect(found.input.facts).toEqual(['accepted', 'queued'])
    expect(bindNativeInput(sessionId, created.context.id, found.input)).toBe(queuedId)
    expect(messages.inputBinding(sessionId, queuedId)).toEqual({
      contextId: created.context.id,
      nativeInputId: receipt.nativeInput.id
    })
    expect(faux.state.callCount).toBe(before)
  })

  it('retains an unresolved Durable creation intent when the native create succeeds but binding fails', async () => {
    const { backend, runtime } = await durable()
    const spy = vi.spyOn(contexts, 'bindContext').mockImplementationOnce(() => {
      throw new Error('binding commit failed')
    })
    await expect(
      createDurableContext(sessionId, backend.id, runtime, { ownership: { kind: 'ownerless' } })
    ).rejects.toThrow('binding commit failed')
    spy.mockRestore()
    const [intent] = contexts.forSession(sessionId)
    expect(intent.nativeThreadId).toBeNull()
    await expect(openNativeContext(intent.id, runtime)).rejects.toThrow('unbound')
    await runtime.shutdown()
    const storage = await openDurableStorage(contexts.backend(backend.id))
    try {
      expect((await storage.scanConversations({}, 10, undefined, BACKGROUND_CONTEXT)).items).toHaveLength(1)
    } finally {
      await storage.close(BACKGROUND_CONTEXT)
    }
  })

  it('does not create a missing Durable store or relabel an empty, unmarked or swapped one', async () => {
    const left = await createDurableBackend()
    const right = await createDurableBackend()
    const path = (id: string) => {
      const locator = contexts.backend(id).locator
      if (locator.kind !== 'pi-durable') throw new Error('wrong test backend')
      return application.getPath('feature.agents.durable.stores', locator.fileName)
    }
    copyFileSync(path(right.id), path(left.id))
    const before = readFileSync(path(left.id))
    await expect(openDurableStorage(contexts.backend(left.id))).rejects.toThrow('identity')
    expect(readFileSync(path(left.id))).toEqual(before)
    writeFileSync(path(left.id), '')
    await expect(openDurableStorage(contexts.backend(left.id))).rejects.toThrow()
    expect(readFileSync(path(left.id))).toHaveLength(0)
    const unmarked = await openNodeSqliteStorage(path(left.id))
    await unmarked.close(BACKGROUND_CONTEXT)
    const unmarkedBytes = readFileSync(path(left.id))
    await expect(openDurableStorage(contexts.backend(left.id))).rejects.toThrow('identity')
    expect(readFileSync(path(left.id))).toEqual(unmarkedBytes)
    rmSync(path(left.id))
    await expect(openDurableStorage(contexts.backend(left.id))).rejects.toThrow()
    expect(existsSync(path(left.id))).toBe(false)
  })

  it('reconciles a native backend marker after the Cherry binding commit fails', async () => {
    const spy = vi.spyOn(contexts, 'bindBackend').mockImplementationOnce(() => {
      throw new Error('DB unavailable')
    })
    await expect(createDurableBackend()).rejects.toThrow('DB unavailable')
    const row = dbh.sqlite.prepare('SELECT id FROM agent_runtime_backend').get() as { id: string }
    spy.mockRestore()
    expect(contexts.backend(row.id).state).toBe('creating')
    const storage = await openDurableStorage(contexts.backend(row.id))
    await storage.close(BACKGROUND_CONTEXT)
    expect(contexts.backend(row.id).state).toBe('creating')
    const recovered = await reconcileDurableBackend(row.id)
    await recovered.close(BACKGROUND_CONTEXT)
    expect(contexts.backend(row.id).state).toBe('bound')
  })
})
