import { loggerService } from '@logger'
import type { CacheCleanupGroupResult, CacheCleanupIssue, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanup'
import { Dexie, type IndexableType } from 'dexie'

const logger = loggerService.withContext('LegacyV1BrowserData')

const LEGACY_DATABASE_NAME = 'CherryStudio'
const INDEXED_DB_PAGE_SIZE = 100

export const LEGACY_LOCAL_STORAGE_KEYS = [
  'persist:cherry-studio',
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

interface BrowserDataMeasurement {
  bytes: number
  failed: boolean
  issues: CacheCleanupIssue[]
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function inspectLegacyLocalStorage(): BrowserDataMeasurement {
  let bytes = 0
  const issues: CacheCleanupIssue[] = []

  for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value !== null) {
        bytes += byteLength(key) + byteLength(value)
      }
    } catch (error) {
      logger.warn('Failed to inspect legacy localStorage key', { key, error })
      issues.push({ item: `local_storage:${key}`, code: 'inspection_failed' })
    }
  }

  return { bytes, failed: issues.length > 0, issues }
}

async function inspectLegacyIndexedDb(): Promise<BrowserDataMeasurement> {
  try {
    if (!(await Dexie.exists(LEGACY_DATABASE_NAME))) {
      return { bytes: 0, failed: false, issues: [] }
    }
  } catch (error) {
    logger.warn('Failed to check legacy IndexedDB existence', error as Error)
    return {
      bytes: 0,
      failed: true,
      issues: [{ item: 'indexeddb:CherryStudio', code: 'inspection_failed' }]
    }
  }

  const db = new Dexie(LEGACY_DATABASE_NAME)
  let bytes = 0
  const issues: CacheCleanupIssue[] = []

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
        issues.push({ item: `indexeddb:CherryStudio:${table.name}`, code: 'inspection_failed' })
      }
    }
  } catch (error) {
    logger.warn('Failed to open legacy IndexedDB', error as Error)
    issues.push({ item: 'indexeddb:CherryStudio', code: 'inspection_failed' })
  } finally {
    db.close()
  }

  return { bytes, failed: issues.length > 0, issues }
}

export async function inspectLegacyV1BrowserData(): Promise<CacheCleanupSizeSnapshot> {
  const localStorageMeasurement = inspectLegacyLocalStorage()
  const indexedDbMeasurement = await inspectLegacyIndexedDb()
  const bytes = localStorageMeasurement.bytes + indexedDbMeasurement.bytes
  const failed = localStorageMeasurement.failed || indexedDbMeasurement.failed

  return {
    bytes: failed && bytes === 0 ? null : bytes,
    accuracy: failed && bytes === 0 ? 'unavailable' : 'estimated',
    completeness: failed ? 'partial' : 'complete',
    issues: [...localStorageMeasurement.issues, ...indexedDbMeasurement.issues]
  }
}

function deleteLegacyIndexedDb(): Promise<'cleared' | 'not_found' | 'blocked' | 'failed'> {
  return Dexie.exists(LEGACY_DATABASE_NAME)
    .then((exists) => {
      if (!exists) return 'not_found' as const

      return new Promise<'cleared' | 'blocked' | 'failed'>((resolve) => {
        const request = indexedDB.deleteDatabase(LEGACY_DATABASE_NAME)
        request.onsuccess = () => resolve('cleared')
        request.onerror = () => resolve('failed')
        request.onblocked = () => resolve('blocked')
      })
    })
    .catch((error) => {
      logger.error('Failed to delete legacy IndexedDB', error as Error)
      return 'failed' as const
    })
}

export async function clearLegacyV1BrowserData(): Promise<CacheCleanupGroupResult> {
  let clearedItems = 0
  const issues: CacheCleanupIssue[] = []

  for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key)
        clearedItems++
      }
    } catch (error) {
      logger.error('Failed to remove legacy localStorage key', { key, error })
      issues.push({ item: `local_storage:${key}`, code: 'operation_failed' })
    }
  }

  const indexedDbResult = await deleteLegacyIndexedDb()
  if (indexedDbResult === 'cleared') {
    clearedItems++
  } else if (indexedDbResult === 'blocked') {
    issues.push({ item: 'indexeddb:CherryStudio', code: 'indexeddb_blocked' })
  } else if (indexedDbResult === 'failed') {
    issues.push({ item: 'indexeddb:CherryStudio', code: 'operation_failed' })
  }

  const hasSuccessfulStep = clearedItems > 0 || indexedDbResult === 'not_found'
  const status: CacheCleanupGroupResult['status'] =
    issues.length > 0 ? (hasSuccessfulStep ? 'partial' : 'failed') : clearedItems > 0 ? 'cleared' : 'not_found'

  return { group: 'legacy_v1', status, issues }
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
    status,
    issues: [...mainResult.issues, ...browserResult.issues]
  }
}
