import { linkSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import type { Storage, Tx, ConversationId } from '@earendil-works/pi-durable'

import { application } from '@application'
import type { AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'

const DURABLE_STORAGE_ERROR_I18N_KEY = 'durable_storage_failed'
const logger = loggerService.withContext('durableNativeContext')

export async function durableContextIdentity() {
  const { defineDoc } = await import('@earendil-works/pi-durable')
  return defineDoc({
    kind: 'cherry.product-context',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    checkpointWhen: () => false,
    initial: () => ({ contextId: '' })
  })
}

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
    checkpointWhen: () => false,
    initial: () => ({ backendId: '' })
  })
  return { ...native, ...sqlite, ...node, nativeContext: BACKGROUND_CONTEXT, backendDocument }
}

function durablePath(backend: AgentRuntimeBackendRow): string {
  if (backend.locator.kind !== 'pi-durable') throw new Error('Backend is not Pi Durable')
  return application.getPath('feature.agents.durable.stores', backend.locator.fileName)
}

/** Publish only an initialized backend; existing stores remain exclusive and strictly validated. */
export async function createDurableBackend(backendId: string) {
  const { openNodeSqliteStorage, createSession, backendDocument, nativeContext } = await loadDurableStorage()
  const backend = contexts.backend(backendId)
  if (backend.state !== 'creating') throw new Error('Native backend is already initialized')
  const path = durablePath(backend)
  let staging: string | undefined
  let stagedPath: string | undefined
  let quarantinePath: string | undefined
  let operation = 'mkdir'
  let attempt: 'initial' | 'retry' = 'initial'
  let initialCollision: unknown
  let cleanupError: unknown
  try {
    mkdirSync(dirname(path), { recursive: true })
    operation = 'staging'
    staging = mkdtempSync(application.getPath('feature.agents.durable.stores', `.${backend.id}-`))
    stagedPath = join(staging, 'store.sqlite')
    operation = 'initialize'
    const storage = await openNodeSqliteStorage(stagedPath)
    const session = createSession(storage)
    try {
      await session.commit(async (tx) => {
        const marker = await tx.doc(backendDocument)
        marker.backendId = backend.id
      }, nativeContext)
    } finally {
      await session.close(nativeContext)
    }
    // Native close checkpoints the WAL; linking publishes the complete store without replacing an existing one.
    operation = 'link'
    try {
      linkSync(stagedPath, path)
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code !== 'EEXIST' && code !== 'EISDIR') throw error
      initialCollision = error
      operation = 'inspect'
      const occupant = lstatSync(path)
      if (occupant.isSymbolicLink() || !occupant.isDirectory()) {
        operation = 'link'
        throw error
      }
      operation = 'quarantine'
      const quarantine = mkdtempSync(application.getPath('feature.agents.durable.stores', `.quarantine-${backend.id}-`))
      quarantinePath = join(quarantine, 'occupant')
      operation = 'rename'
      renameSync(path, quarantinePath)
      logger.warn('Moved durable store directory aside', { backendId, code, quarantinePath })
      operation = 'link'
      attempt = 'retry'
      linkSync(stagedPath, path)
    }
  } catch (error) {
    const { code, errno, syscall } = error as NodeJS.ErrnoException
    if (operation !== 'link' || code !== 'EEXIST') {
      Object.assign(error as Error, { i18nKey: DURABLE_STORAGE_ERROR_I18N_KEY })
      logger.error('Failed to publish durable store', {
        backendId,
        operation,
        attempt,
        code,
        errno,
        syscall,
        sourcePath: stagedPath,
        destinationPath: path,
        quarantinePath,
        error,
        initialCollision
      })
    }
    throw error
  } finally {
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true })
      } catch (error) {
        Object.assign(error as Error, { i18nKey: DURABLE_STORAGE_ERROR_I18N_KEY })
        logger.error('Failed to clean up durable store staging', {
          backendId,
          operation: 'cleanup',
          attempt,
          code: (error as NodeJS.ErrnoException).code,
          errno: (error as NodeJS.ErrnoException).errno,
          syscall: (error as NodeJS.ErrnoException).syscall,
          sourcePath: stagedPath,
          destinationPath: path,
          quarantinePath,
          error,
          initialCollision
        })
        cleanupError = error
      }
    }
  }
  if (cleanupError) throw cleanupError
  contexts.bindBackend(backend.id)
  return contexts.backend(backend.id)
}

export async function openDurableStorage(backend: AgentRuntimeBackendRow): Promise<Storage> {
  const { SqliteStorage, NodeSqliteDatabase, backendDocument, nativeContext } = await loadDurableStorage()
  const path = durablePath(backend)
  const uri = pathToFileURL(path)
  uri.searchParams.set('mode', 'rw')
  let storage: Storage
  try {
    storage = await SqliteStorage.openExisting(new NodeSqliteDatabase(new DatabaseSync(uri, { timeout: 5000 })))
  } catch (error) {
    throw Object.assign(error as Error, { i18nKey: DURABLE_STORAGE_ERROR_I18N_KEY })
  }
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
    if (doc?.version !== 1 || doc.value.backendId !== backend.id)
      throw new Error('Native backend identity does not match')
    return storage
  } catch (error) {
    await storage.close(nativeContext)
    throw error
  }
}

export async function reconcileDurableBackend(backendId: string): Promise<Storage> {
  const backend = contexts.backend(backendId)
  const storage = await openDurableStorage(backend)
  try {
    if (backend.state === 'creating') contexts.bindBackend(backend.id)
    return storage
  } catch (error) {
    const { nativeContext } = await loadDurableStorage()
    await storage.close(nativeContext)
    throw error
  }
}

/** Recover the native identity from the same commit that created the root conversation. */
export async function prepareDurableRoot(contextId: string) {
  const context = contexts.context(contextId)
  if (contexts.backend(context.backendId).state === 'creating') {
    try {
      await createDurableBackend(context.backendId)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        (error as { i18nKey?: string }).i18nKey === DURABLE_STORAGE_ERROR_I18N_KEY
      )
        throw error
    }
  }
  const storage = await reconcileDurableBackend(context.backendId)
  const { nativeContext } = await loadDurableStorage()
  const identity = await durableContextIdentity()
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
    if (nativeId && context.bindingState === 'pending') contexts.bindContext(contextId, nativeId)
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
