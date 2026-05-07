import { loggerService } from '@logger'
import db from '@renderer/databases'
import type { S3Config, WebDavConfig } from '@renderer/types'

const logger = loggerService.withContext('DataSyncService')

const SYNC_VERSION = 1
const SNAPSHOT_FILE = 'sync/cherry-sync-snapshot.json'
const MANIFEST_FILE = 'sync/cherry-sync-manifest.json'
const LOCAL_STORAGE_KEYS = ['persist:cherry-studio', 'memory_currentUserId'] as const
const DEVICE_ID_KEY = 'cherry-sync-device-id'

type SyncProviderName = 'webdav' | 's3'

type SyncManifest = {
  version: number
  snapshotFile: string
  snapshotHash: string
  updatedAt: number
  deviceId: string
}

type SyncSnapshot = {
  version: number
  generatedAt: number
  deviceId: string
  localStorage: Record<string, string>
  indexedDB: Record<string, Record<string, any>[]>
}

type LocalSyncMetadata = {
  deviceId: string
  lastSyncedHash: string | null
  lastSyncedAt: number | null
}

type SyncProvider = {
  name: SyncProviderName
  readText: (fileName: string) => Promise<string>
  writeText: (fileName: string, content: string) => Promise<void>
}

export type SyncResult = {
  action: 'uploaded' | 'downloaded' | 'merged' | 'noop'
  localHash: string
  remoteHash: string
  relaunchRequired: boolean
}

export async function syncWithWebdav(config: WebDavConfig): Promise<SyncResult> {
  return performSync({
    name: 'webdav',
    readText: (fileName) => window.api.backup.readWebdavText(fileName, config),
    writeText: async (fileName, content) => {
      await window.api.backup.writeWebdavText(fileName, content, config)
    }
  })
}

export async function syncWithS3(config: S3Config): Promise<SyncResult> {
  return performSync({
    name: 's3',
    readText: (fileName) => window.api.backup.readS3Text(fileName, config),
    writeText: async (fileName, content) => {
      await window.api.backup.writeS3Text(fileName, content, config)
    }
  })
}

async function performSync(provider: SyncProvider): Promise<SyncResult> {
  const metadata = getLocalMetadata(provider.name)
  const localSnapshot = await createSnapshot(metadata.deviceId)
  const localHash = hashSnapshot(localSnapshot)
  const remoteManifest = await readRemoteManifest(provider)

  if (!remoteManifest) {
    await uploadSnapshot(provider, localSnapshot, localHash)
    saveLocalMetadata(provider.name, {
      deviceId: metadata.deviceId,
      lastSyncedHash: localHash,
      lastSyncedAt: Date.now()
    })
    return { action: 'uploaded', localHash, remoteHash: localHash, relaunchRequired: false }
  }

  if (remoteManifest.snapshotHash === localHash) {
    saveLocalMetadata(provider.name, {
      deviceId: metadata.deviceId,
      lastSyncedHash: localHash,
      lastSyncedAt: remoteManifest.updatedAt
    })
    return { action: 'noop', localHash, remoteHash: localHash, relaunchRequired: false }
  }

  const remoteSnapshot = await readRemoteSnapshot(provider, remoteManifest)
  const remoteHash = remoteManifest.snapshotHash

  if (metadata.lastSyncedHash === remoteHash) {
    await uploadSnapshot(provider, localSnapshot, localHash)
    saveLocalMetadata(provider.name, {
      deviceId: metadata.deviceId,
      lastSyncedHash: localHash,
      lastSyncedAt: Date.now()
    })
    return { action: 'uploaded', localHash, remoteHash: localHash, relaunchRequired: false }
  }

  if (metadata.lastSyncedHash === localHash) {
    await applySnapshot(remoteSnapshot)
    saveLocalMetadata(provider.name, {
      deviceId: metadata.deviceId,
      lastSyncedHash: remoteHash,
      lastSyncedAt: remoteManifest.updatedAt
    })
    return { action: 'downloaded', localHash, remoteHash, relaunchRequired: true }
  }

  const mergedSnapshot = mergeSnapshots(localSnapshot, remoteSnapshot)
  const mergedHash = hashSnapshot(mergedSnapshot)

  await applySnapshot(mergedSnapshot)
  await uploadSnapshot(provider, mergedSnapshot, mergedHash)
  saveLocalMetadata(provider.name, {
    deviceId: metadata.deviceId,
    lastSyncedHash: mergedHash,
    lastSyncedAt: Date.now()
  })

  return { action: 'merged', localHash: mergedHash, remoteHash: mergedHash, relaunchRequired: true }
}

async function createSnapshot(deviceId: string): Promise<SyncSnapshot> {
  const indexedDB: SyncSnapshot['indexedDB'] = {}

  for (const table of db.tables) {
    indexedDB[table.name] = sortRowsByKey(await table.toArray())
  }

  return {
    version: SYNC_VERSION,
    generatedAt: Date.now(),
    deviceId,
    localStorage: readManagedLocalStorage(),
    indexedDB
  }
}

async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  writeManagedLocalStorage(snapshot.localStorage)

  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      const rows = snapshot.indexedDB[table.name] || []
      await table.clear()
      if (rows.length > 0) {
        await table.bulkAdd(rows)
      }
    }
  })
}

async function uploadSnapshot(provider: SyncProvider, snapshot: SyncSnapshot, snapshotHash: string): Promise<void> {
  const serializedSnapshot = stableStringify(snapshot)
  const manifest: SyncManifest = {
    version: SYNC_VERSION,
    snapshotFile: SNAPSHOT_FILE,
    snapshotHash,
    updatedAt: Date.now(),
    deviceId: snapshot.deviceId
  }

  await provider.writeText(SNAPSHOT_FILE, serializedSnapshot)
  await provider.writeText(MANIFEST_FILE, stableStringify(manifest))
}

async function readRemoteManifest(provider: SyncProvider): Promise<SyncManifest | null> {
  try {
    return JSON.parse(await provider.readText(MANIFEST_FILE)) as SyncManifest
  } catch (error) {
    if (isMissingRemoteFile(error)) {
      return null
    }
    logger.error(`Failed to read ${provider.name} sync manifest:`, error as Error)
    throw error
  }
}

async function readRemoteSnapshot(provider: SyncProvider, manifest: SyncManifest): Promise<SyncSnapshot> {
  try {
    return JSON.parse(await provider.readText(manifest.snapshotFile)) as SyncSnapshot
  } catch (error) {
    logger.error(`Failed to read ${provider.name} sync snapshot:`, error as Error)
    throw error
  }
}

function readManagedLocalStorage(): Record<string, string> {
  return LOCAL_STORAGE_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = localStorage.getItem(key)
    if (value !== null) {
      acc[key] = value
    }
    return acc
  }, {})
}

function writeManagedLocalStorage(values: Record<string, string>): void {
  for (const key of LOCAL_STORAGE_KEYS) {
    const value = values[key]
    if (value === undefined) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  }
}

function getLocalMetadata(provider: SyncProviderName): LocalSyncMetadata {
  const key = getMetadataKey(provider)
  const raw = localStorage.getItem(key)
  const deviceId = getOrCreateDeviceId()

  if (!raw) {
    return {
      deviceId,
      lastSyncedHash: null,
      lastSyncedAt: null
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalSyncMetadata>
    return {
      deviceId: parsed.deviceId || deviceId,
      lastSyncedHash: parsed.lastSyncedHash || null,
      lastSyncedAt: parsed.lastSyncedAt || null
    }
  } catch {
    return {
      deviceId,
      lastSyncedHash: null,
      lastSyncedAt: null
    }
  }
}

function saveLocalMetadata(provider: SyncProviderName, metadata: LocalSyncMetadata): void {
  localStorage.setItem(getMetadataKey(provider), JSON.stringify(metadata))
}

function getMetadataKey(provider: SyncProviderName): string {
  return `cherry-sync-metadata:${provider}`
}

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }

  const deviceId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `device-${Date.now()}`
  localStorage.setItem(DEVICE_ID_KEY, deviceId)
  return deviceId
}

function isMissingRemoteFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('not found') ||
    message.includes('404') ||
    message.includes('no such key') ||
    message.includes('does not exist')
  )
}

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot): SyncSnapshot {
  const mergedIndexedDb: SyncSnapshot['indexedDB'] = {}
  const tableNames = new Set([...Object.keys(local.indexedDB), ...Object.keys(remote.indexedDB)])

  for (const tableName of tableNames) {
    mergedIndexedDb[tableName] = mergeTableRecords(local.indexedDB[tableName] || [], remote.indexedDB[tableName] || [])
  }

  return {
    version: Math.max(local.version, remote.version),
    generatedAt: Math.max(local.generatedAt, remote.generatedAt),
    deviceId: local.deviceId,
    localStorage: mergeStringMaps(local.localStorage, remote.localStorage),
    indexedDB: mergedIndexedDb
  }
}

function mergeStringMaps(local: Record<string, string>, remote: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {}
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])

  for (const key of keys) {
    const localValue = local[key]
    const remoteValue = remote[key]

    if (localValue === undefined) {
      merged[key] = remoteValue
      continue
    }

    if (remoteValue === undefined || localValue === remoteValue) {
      merged[key] = localValue
      continue
    }

    merged[key] = remoteValue
  }

  return merged
}

function mergeTableRecords(localRows: Record<string, any>[], remoteRows: Record<string, any>[]): Record<string, any>[] {
  const merged = new Map<string, Record<string, any>>()

  for (const row of localRows) {
    merged.set(getRecordKey(row), row)
  }

  for (const remoteRow of remoteRows) {
    const key = getRecordKey(remoteRow)
    const localRow = merged.get(key)

    if (!localRow) {
      merged.set(key, remoteRow)
      continue
    }

    if (stableStringify(localRow) === stableStringify(remoteRow)) {
      continue
    }

    merged.set(key, pickNewerRecord(localRow, remoteRow))
  }

  return sortRowsByKey(Array.from(merged.values()))
}

function getRecordKey(row: Record<string, any>): string {
  if (row.id !== undefined && row.id !== null) {
    return String(row.id)
  }
  return stableStringify(row)
}

function sortRowsByKey(rows: Record<string, any>[]): Record<string, any>[] {
  return [...rows].sort((left, right) => getRecordKey(left).localeCompare(getRecordKey(right)))
}

function pickNewerRecord(localRow: Record<string, any>, remoteRow: Record<string, any>): Record<string, any> {
  const localTimestamp = extractRecordTimestamp(localRow)
  const remoteTimestamp = extractRecordTimestamp(remoteRow)

  if (localTimestamp !== null && remoteTimestamp !== null) {
    return localTimestamp >= remoteTimestamp ? localRow : remoteRow
  }

  if (localTimestamp !== null) {
    return localRow
  }

  if (remoteTimestamp !== null) {
    return remoteRow
  }

  return remoteRow
}

function extractRecordTimestamp(row: Record<string, any>): number | null {
  const candidates = [row.updated_at, row.updatedAt, row.created_at, row.createdAt]

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue
    }

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }

    const parsed = Date.parse(String(candidate))
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return null
}

export function hashSnapshot(snapshot: SyncSnapshot): string {
  return hashString(
    stableStringify({
      version: snapshot.version,
      localStorage: snapshot.localStorage,
      indexedDB: snapshot.indexedDB
    })
  )
}

function hashString(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
}
