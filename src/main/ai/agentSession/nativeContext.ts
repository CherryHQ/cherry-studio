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
import type { AgentRuntimeBackendRow } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

const nativeContext = BACKGROUND_CONTEXT
const backendDocument = defineDoc({
  kind: 'cherry.runtime-backend',
  version: 1,
  scope: 'session',
  checkpointWhen: () => false,
  initial: () => ({ backendId: '' })
})

function durablePath(backend: AgentRuntimeBackendRow): string {
  if (backend.locator.kind !== 'pi-durable') throw new Error('Backend is not Pi Durable')
  return application.getPath('feature.agents.durable.stores', backend.locator.fileName)
}

/** Explicit creation only. A partial creation is reconciled by opening, never recreated. */
export async function createDurableBackend() {
  const backend = application
    .get('DbService')
    .withWriteTx((tx) =>
      contexts.ensureBackendTx(tx, { version: 1, kind: 'pi-durable', fileName: `${uuid()}.sqlite` }, 'creating')
    )
  const path = durablePath(backend)
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

export async function openDurableStorage(backend: AgentRuntimeBackendRow): Promise<Storage> {
  const path = durablePath(backend)
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
    await storage.close(nativeContext)
    throw error
  }
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
