import { closeSync, lstatSync, mkdirSync, openSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { createSession, defineDoc, type Storage } from '@earendil-works/pi-durable'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { NodeSqliteDatabase, openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { v4 as uuid } from 'uuid'

import { application } from '@application'
import { runtimeId, type OperationResult, type Thread, type ThreadHandle } from '@cherrystudio/agent-runtime'
import { createPiRuntime, type AgentRuntimeSessionOptions, type PiRuntime } from '@cherrystudio/agent-runtime-pi'
import {
  createPiDurableRuntime,
  type PiDurableRuntime,
  type PiDurableRuntimeOptions
} from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

const nativeContext = BACKGROUND_CONTEXT
const backendDocument = defineDoc({
  kind: 'cherry.runtime-backend',
  version: 1,
  scope: 'session',
  initial: () => ({ backendId: '' })
})

function durablePath(backendId: string): string {
  const backend = contexts.backend(backendId)
  if (backend.locator.kind !== 'pi-durable') throw new Error('Backend is not Pi Durable')
  return application.getPath('feature.agents.durable.stores', backend.locator.fileName)
}

/** Explicit creation only. A partial creation is reconciled by opening, never recreated. */
export async function createDurableBackend() {
  const backend = contexts.allocateBackend('pi-durable')
  const path = durablePath(backend.id)
  mkdirSync(dirname(path), { recursive: true })
  closeSync(openSync(path, 'wx'))
  const storage = await openNodeSqliteStorage(path)
  const session = createSession(storage)
  try {
    await session.commit(async (tx) => {
      const marker = await tx.doc(backendDocument)
      marker.backendId = backend.id
    }, nativeContext)
  } finally {
    await session.close(nativeContext)
  }
  contexts.bindBackend(backend.id)
  return contexts.backend(backend.id)
}

export async function openDurableStorage(backendId: string): Promise<Storage> {
  const path = durablePath(backendId)
  const uri = pathToFileURL(path)
  uri.searchParams.set('mode', 'rw')
  const storage = await SqliteStorage.openExisting(new NodeSqliteDatabase(new DatabaseSync(uri, { timeout: 5000 })))
  try {
    const marker = await storage.findDocument(
      {
        kind: backendDocument.definition.kind,
        scope: { kind: 'session' }
      },
      'current',
      nativeContext
    )
    const doc = marker && (await storage.document(marker.id, 'current', nativeContext))
    if (doc?.version !== 1 || doc.value.backendId !== backendId)
      throw new Error('Native backend identity does not match')
    contexts.bindBackend(backendId)
    return storage
  } catch (error) {
    await storage.close(nativeContext)
    throw error
  }
}

export function openDurableBackend(backendId: string, harness: PiDurableRuntimeOptions['harness']) {
  return createPiDurableRuntime({
    backendId: runtimeId(backendId),
    openStorage: () => openDurableStorage(backendId),
    harness
  })
}

export function loadPiSession(backendId: string, nativeId: string, cwd?: string): SessionManager {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeId)) throw new Error('Invalid Pi session identity')
  const directory = application.getPath('feature.agents.pi.sessions')
  const files = readdirSync(directory).filter((file) => file.endsWith(`_${nativeId}.jsonl`))
  if (files.length !== 1) throw new Error('Pi session is missing or ambiguous')
  const file = application.getPath('feature.agents.pi.sessions', files[0])
  if (!lstatSync(file).isFile()) throw new Error('Pi session must be a regular file')
  return SessionManager.openExisting(file, nativeId, cwd)
}

export function openPiBackend(backendId: string, loadOptions: (thread: Thread) => Promise<AgentRuntimeSessionOptions>) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  return createPiRuntime({
    backendId: runtimeId(backendId),
    load: async (thread) => {
      const sessionManager = loadPiSession(backendId, thread.id)
      return { ...(await loadOptions(thread)), sessionManager }
    }
  })
}

export async function createPiContext(
  sessionId: string,
  backendId: string,
  runtime: PiRuntime,
  options: AgentRuntimeSessionOptions
) {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  const intent = contexts.allocateContext(sessionId, backendId, uuid())
  const sessionManager = SessionManager.create(options.cwd, application.getPath('feature.agents.pi.sessions'), {
    id: intent.intendedThreadId!
  })
  const result = await runtime.create({ ...options, sessionManager })
  if (
    result.status === 'confirmed' &&
    (result.value.thread.backendId !== backendId || result.value.thread.id !== intent.intendedThreadId)
  )
    throw new Error('Created Pi identity does not match the intent')
  return { context: intent, result }
}

export function confirmPiContext(contextId: string) {
  const context = contexts.context(contextId)
  if (!context.intendedThreadId) throw new Error('Pi context has no native identity')
  loadPiSession(context.backendId, context.intendedThreadId)
  return contexts.bindContext(context.id, context.intendedThreadId)
}

export async function createDurableContext(
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

export async function openNativeContext(
  contextId: string,
  runtime: PiRuntime | PiDurableRuntime
): Promise<OperationResult<ThreadHandle>> {
  const context = contexts.context(contextId)
  if (!context.nativeThreadId) throw new Error('Native context is unbound')
  return runtime.open({ backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId) })
}
