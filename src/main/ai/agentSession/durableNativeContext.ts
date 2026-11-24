import { linkSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import type { Storage, Tx, ConversationId } from '@earendil-works/pi-durable'
import * as z from 'zod'

import { application } from '@application'
import type { AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { loggerService } from '@logger'
import { getErrorCode, toError } from '@main/utils/error'

const DURABLE_STORAGE_ERROR_I18N_KEY = 'durable_storage_failed'
const logger = loggerService.withContext('durableNativeContext')

const contextIdentitySchema = z.object({ contextId: z.string() })
type NativeConversation = Awaited<ReturnType<Storage['scanConversations']>>['items'][number]

interface DurableErrorDetails {
  code?: string
  errno?: number
  syscall?: string
  storageMarker: 'absent' | 'present' | 'unreadable'
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native filesystem/storage failures are unparsed; retain only checked diagnostic fields and explicit storage-marker evidence.
function readDurableErrorDetails(error: unknown): DurableErrorDetails {
  const details: DurableErrorDetails = { code: getErrorCode(error), storageMarker: 'absent' }

  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return details

  for (const key of ['errno', 'syscall', 'i18nKey'] as const) {
    try {
      // oxlint-disable-next-line anti-slop/no-reflect-get -- Read virtual native error fields without a has trap; unreadable properties cannot replace the original failure.
      const value: unknown = Reflect.get(error, key)

      if (key === 'i18nKey') details.storageMarker = value === DURABLE_STORAGE_ERROR_I18N_KEY ? 'present' : 'absent'

      if (key === 'errno' && typeof value === 'number') details.errno = value

      if (key === 'syscall' && typeof value === 'string') details.syscall = value
    } catch {
      if (key === 'i18nKey') details.storageMarker = 'unreadable'
    }
  }

  return details
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Storage failures need an Error for localized reporting; preserve native Error identity and retain foreign rejection values as cause.
function tagStorageError(error: unknown, details: DurableErrorDetails): Error {
  const failure = toError(error, 'Durable storage failed')

  if (failure !== error) Object.assign(failure, { code: details.code, errno: details.errno, syscall: details.syscall })

  return Object.assign(failure, { i18nKey: DURABLE_STORAGE_ERROR_I18N_KEY })
}

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
      const code = getErrorCode(error)

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
    const details = readDurableErrorDetails(error)
    const { code, errno, syscall } = details

    if (operation !== 'link' || code !== 'EEXIST') {
      const failure = tagStorageError(error, details)
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
        error: failure,
        initialCollision
      })

      throw failure
    }

    throw error
  } finally {
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true })
      } catch (error) {
        const details = readDurableErrorDetails(error)
        const failure = tagStorageError(error, details)
        logger.error('Failed to clean up durable store staging', {
          backendId,
          operation: 'cleanup',
          attempt,
          code: details.code,
          errno: details.errno,
          syscall: details.syscall,
          sourcePath: stagedPath,
          destinationPath: path,
          quarantinePath,
          error: failure,
          initialCollision
        })
        cleanupError = failure
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
    throw tagStorageError(error, readDurableErrorDetails(error))
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
  if (context.parentContextId !== null) throw new Error('Durable context is not a product root')

  if (contexts.backend(context.backendId).state === 'creating') {
    try {
      await createDurableBackend(context.backendId)
    } catch (error) {
      const details = readDurableErrorDetails(error)

      if (details.code !== 'EEXIST' || details.storageMarker !== 'absent') throw error
    }
  }

  const storage = await reconcileDurableBackend(context.backendId)
  const { nativeContext } = await loadDurableStorage()
  const identity = await durableContextIdentity()

  try {
    const conversations = new Map<number, NativeConversation>()
    const identities = new Map<string, { conversation: NativeConversation; version: number }[]>()
    let cursor: Parameters<Storage['scanConversations']>[2]

    do {
      const page = await storage.scanConversations({}, 256, cursor, nativeContext)

      for (const conversation of page.items) {
        conversations.set(conversation.id, conversation)
        const address = await storage.findDocument(
          { kind: identity.definition.kind, scope: { kind: 'conversation', conversationId: conversation.id } },
          'current',
          nativeContext
        )

        const doc = address && (await storage.document(address.id, 'current', nativeContext))

        if (!doc) continue
        const marker = contextIdentitySchema.parse(doc.value)
        const matches = identities.get(marker.contextId) ?? []
        matches.push({ conversation, version: doc.version })
        identities.set(marker.contextId, matches)
      }

      cursor = page.next
    } while (cursor)

    const resolveNativeId = (binding: AgentSessionContextRow): ConversationId | undefined => {
      if (binding.backendId !== context.backendId || binding.parentContextId !== null)
        throw new Error('Durable context is not a root of this backend')
      const matches = identities.get(binding.id) ?? []
      if (matches.length > 1) throw new Error('Durable context identity does not match')
      const match = matches[0]
      if (match && (match.version !== 1 || match.conversation.owner !== undefined))
        throw new Error('Durable context identity does not match')
      const nativeId = match?.conversation.id
      if (binding.nativeThreadId !== null && (nativeId === undefined || String(nativeId) !== binding.nativeThreadId))
        throw new Error('Durable context identity does not match')
      return nativeId
    }

    const recoveredId = resolveNativeId(context)
    const nativeId = recoveredId === undefined ? undefined : String(recoveredId)
    if (nativeId !== undefined && context.bindingState === 'pending') contexts.bindContext(contextId, nativeId)

    return {
      storage,
      nativeId,
      conversations,
      resolveNativeId,
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
