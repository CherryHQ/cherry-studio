import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { createRegistry } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { OperationResult } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

import { backfillNativeContexts } from '../backfillNativeContexts'
import {
  confirmPiContext,
  createDurableBackend,
  createDurableContext,
  createPiContext,
  loadPiSession,
  openDurableBackend,
  openDurableStorage,
  openNativeContext,
  openPiBackend
} from '../nativeContext'
import { observeNativeThread, reconcileDurableMessage } from '../nativeSubmission'

function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
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
  async function pi() {
    const backend = contexts.allocateBackend('pi')
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

  it('keeps an unflushed Pi context unresolved, then strictly restores its original native history', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const handle = confirmed(created.result)
    expect(() => confirmPiContext(created.context.id)).toThrow('missing')
    const errors: unknown[] = []
    const observer = await observeNativeThread(sessionId, handle, (error) => errors.push(error))
    cleanup.push(() => observer.stop())
    const inputId = message()
    faux.setResponses([fauxAssistantMessage('saved answer')])
    expect((await observer.submit(inputId, created.context.id, 'reject')).status).toBe('acknowledged')
    await expect.poll(() => messages.readSubmission(sessionId, inputId).submission.outcome).toBe('completed')
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
          for (const item of event.items) {
            if (item.type === 'message') text.push(...item.parts.map((part) => part.text))
          }
      })
    )
    expect(text.join('\n')).toContain('saved answer')
    expect(errors).toEqual([])
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

  it('backfills all distinct native identities idempotently without changing old rows or creating missing files', async () => {
    const { backend } = await pi()
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
    const result = backfillNativeContexts(sessionId)
    expect(result.bound).toHaveLength(1)
    expect(result.unresolved).toHaveLength(1)
    expect(backfillNativeContexts(sessionId)).toEqual(result)
    expect(contexts.forSession(sessionId)).toHaveLength(2)
    expect(contexts.backend(backend.id).id).toBe(backend.id)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
    expect(readdirSync(application.getPath('feature.agents.pi.sessions'))).toEqual(files)
  })

  it('does not dispatch when the message submission transaction fails', async () => {
    const { backend, runtime, options, faux } = await pi()
    const created = await createPiContext(sessionId, backend.id, runtime, options)
    const observer = await observeNativeThread(sessionId, confirmed(created.result), (error) => {
      throw error
    })
    cleanup.push(() => observer.stop())
    const id = message()
    vi.spyOn(messages, 'prepareSubmission').mockImplementationOnce(() => {
      throw new Error('DB write failed')
    })
    await expect(observer.submit(id, created.context.id, 'reject')).rejects.toThrow('DB write failed')
    expect(faux.state.callCount).toBe(0)
    expect(messages.hasSubmission(sessionId, id)).toBe(false)
  })

  it.each(['read', 'write'] as const)(
    'retains native input evidence when its Cherry %s fails, then flushes without another invocation',
    async (failure) => {
      const { backend, runtime, options, faux } = await pi()
      const created = await createPiContext(sessionId, backend.id, runtime, options)
      const errors: unknown[] = []
      const observer = await observeNativeThread(sessionId, confirmed(created.result), (error) => errors.push(error))
      cleanup.push(() => observer.stop())
      const fail = () => {
        throw new Error('simulated DB failure')
      }
      const spy =
        failure === 'read'
          ? vi.spyOn(messages, 'hasSubmission').mockImplementation(fail)
          : vi.spyOn(messages, 'mergeSubmissionTx').mockImplementation(fail)
      faux.setResponses([fauxAssistantMessage('one native invocation')])
      const id = message()
      expect((await observer.submit(id, created.context.id, 'reject')).status).toBe('acknowledged')
      await expect
        .poll(() => {
          try {
            return loadPiSession(backend.id, created.context.intendedThreadId!).getBranch().length
          } catch {
            return 0
          }
        })
        .toBeGreaterThan(0)
      await expect.poll(() => errors.length).toBeGreaterThan(1)
      spy.mockRestore()
      observer.flush()
      await expect.poll(() => messages.readSubmission(sessionId, id).submission.outcome).toBe('completed')
      await expect(observer.submit(id, created.context.id, 'reject')).rejects.toThrow('already submitted')
      expect(
        loadPiSession(backend.id, created.context.intendedThreadId!)
          .getBranch()
          .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
      ).toHaveLength(1)
    }
  )

  it('restores Durable inputs by their original message key without scheduling work on reopen', async () => {
    const { backend, runtime, faux, options } = await durable()
    const created = await createDurableContext(sessionId, backend.id, runtime, {
      ownership: { kind: 'ownerless' },
      agent: { model: { provider: 'faux', modelId: 'faux-1' } }
    })
    const handle = confirmed(created.result)
    const observer = await observeNativeThread(sessionId, handle, (error) => {
      throw error
    })
    cleanup.push(() => observer.stop())
    faux.setResponses([fauxAssistantMessage('durable native answer')])
    const id = message()
    expect((await observer.submit(id, created.context.id, 'reject')).status).toBe('acknowledged')
    await expect.poll(() => messages.readSubmission(sessionId, id).submission.outcome).toBe('completed')
    await observer.stop()
    await runtime.shutdown()
    const reopened = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => reopened.shutdown())
    const restored = confirmed(await reopened.open(handle.thread))
    const result = confirmed(await reconcileDurableMessage(sessionId, id, restored))
    expect(result).toMatchObject({ found: true, input: { outcome: 'completed' } })
    const repeated = await restored.input.submit({
      ...messages.readSubmission(sessionId, id).draft,
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
    const observer = await observeNativeThread(sessionId, handle, (error) => {
      throw error
    })
    const id = message()
    await observer.submit(id, created.context.id, 'reject')
    await reached.promise
    await observer.stop()
    await runtime.shutdown()
    const before = faux.state.callCount
    faux.setResponses([fauxAssistantMessage('explicitly resumed')])
    const reopened = confirmed(await openDurableBackend(backend.id, options))
    cleanup.push(() => reopened.shutdown())
    const access = confirmed(await reopened.open(handle.thread))
    expect(confirmed(await reconcileDurableMessage(sessionId, id, access))).toMatchObject({
      found: true,
      input: { facts: ['accepted', 'placed'] }
    })
    expect(messages.readSubmission(sessionId, id).submission.outcome).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(faux.state.callCount).toBe(before)
    confirmed(await reopened.resume())
    await expect
      .poll(async () => {
        await reconcileDurableMessage(sessionId, id, access)
        return messages.readSubmission(sessionId, id).submission.outcome
      })
      .toBe('completed')
    expect(faux.state.callCount).toBe(before + 1)
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
    const storage = await openDurableStorage(backend.id)
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
    await expect(openDurableStorage(left.id)).rejects.toThrow('identity')
    expect(readFileSync(path(left.id))).toEqual(before)
    writeFileSync(path(left.id), '')
    await expect(openDurableStorage(left.id)).rejects.toThrow()
    expect(readFileSync(path(left.id))).toHaveLength(0)
    const unmarked = await openNodeSqliteStorage(path(left.id))
    await unmarked.close(BACKGROUND_CONTEXT)
    const unmarkedBytes = readFileSync(path(left.id))
    await expect(openDurableStorage(left.id)).rejects.toThrow('identity')
    expect(readFileSync(path(left.id))).toEqual(unmarkedBytes)
    rmSync(path(left.id))
    await expect(openDurableStorage(left.id)).rejects.toThrow()
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
    const storage = await openDurableStorage(row.id)
    await storage.close(BACKGROUND_CONTEXT)
    expect(contexts.backend(row.id).state).toBe('bound')
  })
})
