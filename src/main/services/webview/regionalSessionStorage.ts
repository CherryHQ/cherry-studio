import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { MINI_APP_ID_REGEX } from '@shared/data/api/schemas/miniApps'
import { MINI_APP_REGIONS, type MiniAppCountry } from '@shared/types/miniAppRegion'

const COUNTRIES = Object.keys(MINI_APP_REGIONS) as MiniAppCountry[]
const PERSIST_PREFIX = 'persist:'

export function getMiniAppRegionPartition(appId: string, country: MiniAppCountry): string {
  // Electron lowercases partition directory names. A fixed-length digest keeps the original ID's case
  // and supports catalog IDs that are too long to use as a directory component.
  const key = createHash('sha256').update(appId, 'utf16le').digest('hex')
  return `persist:webview-region-v2:${country.toLowerCase()}:${key}`
}

export function getRegionalPartitionDirectory(partition: string): string {
  // These names contain only colons and ASCII catalog ID characters. This is the same
  // lowercasing and path escaping used by Electron for this subset of persistent partition names.
  return encodeURIComponent(partition.slice(PERSIST_PREFIX.length).toLowerCase())
}

async function readDirectory(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function findStoredRegionalPartitions(appId: string, allowLegacy: boolean): Promise<string[]> {
  const root = application.getPath('app.session', 'Partitions')
  const entries = new Map((await readDirectory(root)).map((entry) => [entry.name, entry]))
  const candidates = COUNTRIES.map((country) => getMiniAppRegionPartition(appId, country))

  // Earlier experimental partitions may alias each other on disk. They are never used for
  // attachment. A reset can clear the old data once no other saved website could own it.
  if (allowLegacy && MINI_APP_ID_REGEX.test(appId)) {
    const legacyId = appId.toLowerCase()
    for (const country of COUNTRIES) {
      candidates.push(
        country === 'US'
          ? `persist:webview-us:${legacyId}`
          : `persist:webview-fake:${country.toLowerCase()}:${legacyId}`
      )
    }
  }

  return candidates.filter((partition) => {
    const entry = entries.get(getRegionalPartitionDirectory(partition))
    if (!entry) return false
    if (!entry.isDirectory()) throw new Error('Regional storage path is not a directory')
    return true
  })
}

export async function verifyRegionalIndexedDbCleared(storagePath: string | null): Promise<void> {
  if (!storagePath) throw new Error('Regional session has no persistent storage path')

  // Electron's clearData can still resolve when Chromium drops an individual quota bucket error.
  // Check the first-party and bucket IndexedDB paths before lifting the recovery barrier.
  const legacy = await readDirectory(path.join(storagePath, 'IndexedDB'))
  const buckets = (await readDirectory(path.join(storagePath, 'WebStorage'))).filter(({ name }) => /^\d+$/.test(name))
  const bucketData = await Promise.all(
    buckets.map(({ name }) => readDirectory(path.join(storagePath, 'WebStorage', name, 'IndexedDB')))
  )
  if (legacy.length > 0 || bucketData.some((entries) => entries.length > 0)) {
    throw new Error('Regional IndexedDB data could not be cleared')
  }
}
