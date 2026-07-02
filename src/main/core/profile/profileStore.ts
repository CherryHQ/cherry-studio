import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { PROFILES_CONFIG_PATH } from '@main/core/paths/constants'

import { DEFAULT_PROFILE_ID, findEntry, type ProfileEntry, type ProfileRegistry } from './profileRegistry'

const logger = loggerService.withContext('ProfileStore')

/** The default profile entry; its `dataDir` sentinel resolves to the legacy root. */
const DEFAULT_ENTRY: ProfileEntry = {
  id: DEFAULT_PROFILE_ID,
  dataDir: DEFAULT_PROFILE_ID,
  name: 'Default',
  createdAt: 0
}

/** A registry containing only the default profile — the fallback for a missing or corrupt file. */
export function defaultRegistry(): ProfileRegistry {
  return { activeProfileId: DEFAULT_PROFILE_ID, profiles: [DEFAULT_ENTRY] }
}

function isProfileEntry(value: unknown): value is ProfileEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.dataDir === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.createdAt === 'number'
  )
}

/**
 * Validate + normalize parsed JSON into a registry that always satisfies the
 * invariants: the default profile is present, and `activeProfileId` names an
 * existing profile. Anything malformed falls back to {@link defaultRegistry}.
 */
function normalize(raw: unknown): ProfileRegistry {
  if (typeof raw !== 'object' || raw === null) return defaultRegistry()
  const obj = raw as Record<string, unknown>
  if (typeof obj.activeProfileId !== 'string' || !Array.isArray(obj.profiles) || !obj.profiles.every(isProfileEntry)) {
    return defaultRegistry()
  }
  // The default profile must always exist — it maps to the legacy data root.
  const profiles = obj.profiles.some((entry) => entry.id === DEFAULT_PROFILE_ID)
    ? obj.profiles
    : [DEFAULT_ENTRY, ...obj.profiles]
  const activeProfileId = profiles.some((entry) => entry.id === obj.activeProfileId)
    ? obj.activeProfileId
    : DEFAULT_PROFILE_ID
  return { activeProfileId, profiles }
}

/**
 * Read the registry from disk, always returning a valid one: a missing file,
 * unparseable JSON, or a malformed shape falls back to the default registry.
 */
export function readProfileRegistry(configPath: string = PROFILES_CONFIG_PATH): ProfileRegistry {
  if (!existsSync(configPath)) return defaultRegistry()
  try {
    return normalize(JSON.parse(readFileSync(configPath, 'utf-8')))
  } catch (error) {
    logger.error('Failed to read profiles.json; falling back to the default profile', error as Error)
    return defaultRegistry()
  }
}

/** Persist the registry atomically (write to a temp file, then rename over the target). */
export function writeProfileRegistry(registry: ProfileRegistry, configPath: string = PROFILES_CONFIG_PATH): void {
  mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf-8')
  renameSync(tmp, configPath)
}

let bootProfile: ProfileEntry | undefined

/**
 * The active profile at boot, resolved once and memoized — several preboot
 * consumers (path slot install, DbService) need it, and the file must be read a
 * single time. Guaranteed to return an entry (the default always exists).
 */
export function resolveBootProfile(): ProfileEntry {
  if (!bootProfile) {
    const registry = readProfileRegistry()
    bootProfile = findEntry(registry, registry.activeProfileId) ?? DEFAULT_ENTRY
  }
  return bootProfile
}

/** Clear the memoized boot profile. For tests only. */
export function resetBootProfileCache(): void {
  bootProfile = undefined
}
