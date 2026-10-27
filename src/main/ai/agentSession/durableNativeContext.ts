import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import type { Storage, Tx, ConversationId } from '@earendil-works/pi-durable'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import type { PiDurableRuntime, PiDurableRuntimeOptions } from '@cherrystudio/agent-runtime-pi-durable'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

async function loadDurableStorage() {
  const [native, sqlite, node, { BACKGROUND_CONTEXT }] = await Promise.all([
    import('@earendil-works/pi-durable'),
    import('@earendil-works/pi-durable/storage/sqlite'),
    import('@earendil-works/pi-durable/storage/sqlite/node'),
    import('@earendil-works/chord/context')
  ])
  const backendDocument = native.defineDoc({
    kind: 'cherry.runtime-backend',
    version: 1,
    scope: 'session',
    initial: () => ({ backendId: '' })
  })
  return { ...native, ...sqlite, ...node, nativeContext: BACKGROUND_CONTEXT, backendDocument }
}

function durablePath(backendId: string): string {
  const backend = contexts.backend(backendId)
  if (backend.locator.kind !== 'pi-durable') throw new Error('Backend is not Pi Durable')
  return application.getPath('feature.agents.durable.stores', backend.locator.fileName)
}

/** Explicit creation only. A partial creation is reconciled by opening, never recreated. */
export async function createDurableBackend(backendId?: string) {
  const { openNodeSqliteStorage, createSession, backendDocument, nativeContext } = await loadDurableStorage()
  const backend = backendId ? contexts.backend(backendId) : contexts.allocateBackend('pi-durable')
  if (backend.state !== 'creating') throw new Error('Native backend is already initialized')
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
  const { SqliteStorage, NodeSqliteDatabase, backendDocument, nativeContext } = await loadDurableStorage()
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

export async function openDurableBackend(backendId: string, harness: PiDurableRuntimeOptions['harness']) {
  const { createPiDurableRuntime } = await import('@cherrystudio/agent-runtime-pi-durable')
  return createPiDurableRuntime({
    backendId: runtimeId(backendId),
    openStorage: () => openDurableStorage(backendId),
    harness
  })
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

/** Recover the native identity from the same commit that created the root conversation. */
export async function prepareDurableRoot(contextId: string) {
  const context = contexts.context(contextId)
  if (contexts.backend(context.backendId).state === 'creating') {
    try {
      await createDurableBackend(context.backendId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const storage = await openDurableStorage(context.backendId)
  const { defineDoc, nativeContext } = await loadDurableStorage()
  const identity = defineDoc({
    kind: 'cherry.product-context',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    initial: () => ({ contextId: '' })
  })
  try {
    const matches: string[] = []
    let cursor: Parameters<Storage['scanConversations']>[2]
    do {
      const page = await storage.scanConversations({}, 256, cursor, nativeContext)
      for (const conversation of page.items) {
        const address = await storage.findDocument(
          { kind: identity.definition.kind, scope: { kind: 'conversation', conversationId: conversation.id } },
          'current',
          nativeContext
        )
        const doc = address && (await storage.document(address.id, 'current', nativeContext))
        if (doc?.value.contextId === contextId) matches.push(String(conversation.id))
      }
      cursor = page.next
    } while (cursor)
    if (matches.length > 1 || (context.nativeThreadId && matches[0] !== context.nativeThreadId))
      throw new Error('Durable context identity does not match')
    const nativeId = matches[0]
    if (nativeId && !context.nativeThreadId) contexts.bindContext(contextId, nativeId)
    return {
      storage,
      nativeId,
      init: async (tx: Tx, id: ConversationId) => {
        const doc = await tx.doc(identity, id)
        doc.contextId = contextId
      }
    }
  } catch (error) {
    await storage.close(nativeContext)
    throw error
  }
}
