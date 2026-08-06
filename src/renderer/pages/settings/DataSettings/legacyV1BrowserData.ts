import { loggerService } from '@logger'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanup'
import { Dexie, type IndexableType } from 'dexie'

const logger = loggerService.withContext('LegacyV1BrowserData')

const LEGACY_DATABASE_NAME = 'CherryStudio'
const LEGACY_PERSISTED_STATE_KEY = 'persist:cherry-studio'
const LEGACY_CLEANUP_RETRY_MARKER_KEY = 'cherry-studio:legacy-v1-cleanup-pending'
const INDEXED_DB_PAGE_SIZE = 100
const textEncoder = new TextEncoder()

export const LEGACY_LOCAL_STORAGE_KEYS = [
  LEGACY_PERSISTED_STATE_KEY,
  'onboarding-completed',
  'memory_currentUserId',
  'privacy-popup-accepted',
  'language',
  'openai_alert_closed',
  'migration:theme_mode',
  'ai302_token',
  'tokenLanyunToken',
  'mcprouter_token',
  'tokenflux_token'
] as const

const LEGACY_LOCAL_STORAGE_PREFIX = 'failed_favicon_'

interface BrowserDataMeasurement {
  bytes: number
  hasFailures: boolean
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

export function hasLegacyV1Marker(): boolean {
  try {
    return (
      localStorage.getItem(LEGACY_PERSISTED_STATE_KEY) !== null ||
      localStorage.getItem(LEGACY_CLEANUP_RETRY_MARKER_KEY) !== null
    )
  } catch (error) {
    logger.warn('Failed to inspect legacy localStorage marker', error as Error)
    return false
  }
}

export function beginLegacyV1Cleanup(): void {
  localStorage.setItem(LEGACY_CLEANUP_RETRY_MARKER_KEY, 'true')
}

export function finalizeLegacyV1Cleanup(result: CacheCleanupGroupResult): CacheCleanupGroupResult {
  if (result.status === 'cleared' || result.status === 'not_found') {
    localStorage.removeItem(LEGACY_CLEANUP_RETRY_MARKER_KEY)
  }
  return result
}

function collectLegacyLocalStorageKeys(): { keys: Set<string>; error?: unknown } {
  const keys = new Set<string>(LEGACY_LOCAL_STORAGE_KEYS)
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(LEGACY_LOCAL_STORAGE_PREFIX)) {
        keys.add(key)
      }
    }
    return { keys }
  } catch (error) {
    return { keys, error }
  }
}

function inspectLegacyLocalStorage(): BrowserDataMeasurement {
  let bytes = 0
  let hasFailures = false
  const { keys, error: enumerationError } = collectLegacyLocalStorageKeys()
  if (enumerationError) {
    logger.warn('Failed to enumerate legacy localStorage keys', enumerationError as Error)
    hasFailures = true
  }

  for (const key of keys) {
    try {
      const value = localStorage.getItem(key)
      if (value !== null) {
        bytes += byteLength(key) + byteLength(value)
      }
    } catch (error) {
      logger.warn('Failed to inspect legacy localStorage key', { key, error })
      hasFailures = true
    }
  }

  return { bytes, hasFailures }
}

async function inspectLegacyIndexedDb(): Promise<BrowserDataMeasurement> {
  try {
    if (!(await Dexie.exists(LEGACY_DATABASE_NAME))) {
      return { bytes: 0, hasFailures: false }
    }
  } catch (error) {
    logger.warn('Failed to check legacy IndexedDB existence', error as Error)
    return { bytes: 0, hasFailures: true }
  }

  const db = new Dexie(LEGACY_DATABASE_NAME)
  let bytes = 0
  let hasFailures = false

  try {
    await db.open()

    for (const table of db.tables) {
      let lastPrimaryKey: IndexableType | undefined

      try {
        while (true) {
          const collection =
            lastPrimaryKey === undefined ? table.orderBy(':id') : table.where(':id').above(lastPrimaryKey)
          const primaryKeys = await collection.limit(INDEXED_DB_PAGE_SIZE).primaryKeys()
          if (primaryKeys.length === 0) break

          const records = await table.bulkGet(primaryKeys)
          for (const record of records) {
            if (record === undefined) {
              throw new Error('IndexedDB record missing from page')
            }
            const serialized = JSON.stringify(record)
            if (serialized === undefined) {
              throw new Error('IndexedDB record is not serializable')
            }
            bytes += byteLength(serialized)
          }

          lastPrimaryKey = primaryKeys[primaryKeys.length - 1]
        }
      } catch (error) {
        logger.warn('Failed to inspect legacy IndexedDB table', { table: table.name, error })
        hasFailures = true
      }
    }
  } catch (error) {
    logger.warn('Failed to open legacy IndexedDB', error as Error)
    hasFailures = true
  } finally {
    db.close()
  }

  return { bytes, hasFailures }
}

export async function inspectLegacyV1BrowserData(): Promise<CacheCleanupSizeSnapshot> {
  const localStorageMeasurement = inspectLegacyLocalStorage()
  const indexedDbMeasurement = await inspectLegacyIndexedDb()
  const bytes = localStorageMeasurement.bytes + indexedDbMeasurement.bytes
  const partial = localStorageMeasurement.hasFailures || indexedDbMeasurement.hasFailures

  return {
    bytes: partial && bytes === 0 ? null : bytes,
    accuracy: partial && bytes === 0 ? 'unavailable' : 'estimated',
    completeness: partial ? 'partial' : 'complete'
  }
}

async function deleteLegacyIndexedDb(onBlocked?: () => void): Promise<'cleared' | 'not_found' | 'failed'> {
  try {
    if (!(await Dexie.exists(LEGACY_DATABASE_NAME))) return 'not_found'
    return await new Promise<'cleared' | 'failed'>((resolve) => {
      const request = indexedDB.deleteDatabase(LEGACY_DATABASE_NAME)
      request.onsuccess = () => resolve('cleared')
      request.onerror = () => {
        logger.error('Failed to delete legacy IndexedDB', request.error ?? new Error('IndexedDB deletion failed'))
        resolve('failed')
      }
      request.onblocked = () => {
        logger.warn('Waiting for legacy IndexedDB connections to close')
        onBlocked?.()
      }
    })
  } catch (error) {
    logger.error('Failed to delete legacy IndexedDB', error as Error)
    return 'failed'
  }
}

export async function clearLegacyV1BrowserData(onIndexedDbBlocked?: () => void): Promise<CacheCleanupGroupResult> {
  let clearedItems = 0
  let failedItems = 0
  const { keys, error: enumerationError } = collectLegacyLocalStorageKeys()
  if (enumerationError) {
    logger.error('Failed to enumerate legacy localStorage keys', enumerationError as Error)
    failedItems++
  }

  for (const key of keys) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key)
        clearedItems++
      }
    } catch (error) {
      logger.error('Failed to remove legacy localStorage key', { key, error })
      failedItems++
    }
  }

  const indexedDbResult = await deleteLegacyIndexedDb(onIndexedDbBlocked)
  if (indexedDbResult === 'cleared') {
    clearedItems++
  } else if (indexedDbResult === 'failed') {
    failedItems++
  }

  const hasSuccessfulStep = clearedItems > 0 || indexedDbResult === 'not_found'
  const status: CacheCleanupGroupResult['status'] =
    failedItems > 0 ? (hasSuccessfulStep ? 'partial' : 'failed') : clearedItems > 0 ? 'cleared' : 'not_found'

  return { group: 'legacy_v1', status }
}

export function mergeLegacyV1CleanupResults(
  mainResult: CacheCleanupGroupResult,
  browserResult: CacheCleanupGroupResult
): CacheCleanupGroupResult {
  const statuses = [mainResult.status, browserResult.status]
  const hasSuccessfulStep = statuses.some((status) => status === 'cleared' || status === 'not_found')

  let status: CacheCleanupGroupResult['status']
  if (statuses.includes('partial')) {
    status = 'partial'
  } else if (statuses.includes('failed')) {
    status = hasSuccessfulStep ? 'partial' : 'failed'
  } else if (statuses.includes('skipped')) {
    status = hasSuccessfulStep ? 'partial' : 'skipped'
  } else if (statuses.includes('cleared')) {
    status = 'cleared'
  } else {
    status = 'not_found'
  }

  return {
    group: 'legacy_v1',
    status
  }
}
