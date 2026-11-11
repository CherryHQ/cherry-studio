import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'
import { app } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { SEED_KEY_PREFIX } from '@data/db/seeding/SeedRunner'
import { getLegacyProfilePaths } from '@main/core/paths/legacyProfilePaths'
import { getNormalizedExecutablePath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'

import { MIGRATION_V2_STATUS, migrationStatusSchema } from './migrationStatus'

export const LEGACY_UPGRADE_VERSION = '2.1.0'

export function getLegacyUpgradeDownloadUrl({
  platform,
  arch,
  translated,
  portable,
  version = LEGACY_UPGRADE_VERSION,
  edition = 'global'
}: {
  platform: NodeJS.Platform
  arch: string
  translated: boolean
  portable: boolean
  version?: typeof LEGACY_UPGRADE_VERSION | '1.9.12'
  edition?: 'global' | 'cn'
}): string {
  const nativeArch = translated ? 'arm64' : arch
  if (nativeArch !== 'arm64' && nativeArch !== 'x64') throw new Error(`Unsupported architecture: ${nativeArch}`)
  let asset: string
  switch (platform) {
    case 'darwin':
      asset = `mac-${nativeArch}.dmg`
      break
    case 'win32':
      asset = `win-${nativeArch}-${portable ? 'portable' : 'setup'}.exe`
      break
    case 'linux':
      asset = `linux-${nativeArch}.AppImage`
      break
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
  if (version === '1.9.12') {
    asset = asset.replace(/^(mac|win|linux)-/, '')
    if (platform === 'linux' && nativeArch === 'x64') asset = 'x86_64.AppImage'
  }
  return `https://github.com/CherryHQ/cherry-studio/releases/download/v${version}/Cherry-Studio-${edition === 'cn' && version !== '1.9.12' ? 'CN-' : ''}${version}-${asset}`
}

function statIfPresent(file: string) {
  try {
    return fs.statSync(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** Read-only: classification must never initialize or migrate the user's database. */
export function inspectLegacyProfile(userData: string): 'fresh' | 'ready' | 'legacy' {
  const paths = getLegacyProfilePaths(userData)
  if (statIfPresent(paths.database)?.size) {
    const db = new Database(paths.database, { readonly: true, fileMustExist: true })
    try {
      const value = db.prepare('SELECT value FROM app_state WHERE key = ?').pluck().get(MIGRATION_V2_STATUS)
      if (value !== undefined) {
        const status = migrationStatusSchema.parse(JSON.parse(z.string().parse(value)))
        return status.status === 'completed' ? 'ready' : 'legacy'
      }
      // The retired converter created schemas before recording progress, but never ran seeders.
      const seeded = db.prepare('SELECT key FROM app_state WHERE key LIKE ? LIMIT 1').get(`${SEED_KEY_PREFIX}%`)
      if (seeded) return 'ready'
    } finally {
      db.close()
    }
  }
  if (statIfPresent(paths.version)) return 'legacy'
  if (statIfPresent(paths.indexedDb) && statIfPresent(paths.localStorage)) return 'legacy'
  if (statIfPresent(paths.config)) {
    const config = z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(paths.config, 'utf8')))
    if (Object.keys(config).length) return 'legacy'
  }
  return 'fresh'
}

const legacyConfigSchema = z.object({
  appDataPath: z
    .union([z.string().min(1), z.array(z.object({ executablePath: z.string(), dataPath: z.string().min(1) }))])
    .optional()
})

function sameLocation(a: string, b: string) {
  const normalize = (value: string) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
  return normalize(a) === normalize(b)
}

function isPortableExecutable(executable: string) {
  return executable.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() === 'cherry-studio-portable.exe'
}

export type LegacyUpgradeProfile = { kind: 'legacy' | 'recover'; path: string }

/** Classifies a selected profile without redirecting or writing it. */
export function findLegacyUpgradeProfile(): LegacyUpgradeProfile | undefined {
  const current = application.getPath('app.userdata')
  const exe = getNormalizedExecutablePath()
  const configured = app.isPackaged ? bootConfigService.get('app.user_data_path')?.[exe] : undefined
  if (configured && !isUsableDataDir(configured)) throw new Error(`Data directory unavailable: ${configured}`)
  const state = inspectLegacyProfile(current)
  if (state === 'ready') return undefined
  if (state === 'legacy') return { kind: 'legacy', path: current }
  if (!app.isPackaged || configured) return undefined

  const configFile = application.getPath('v1.home_config_file')
  if (!statIfPresent(configFile)) return undefined
  const { appDataPath } = legacyConfigSchema.parse(JSON.parse(fs.readFileSync(configFile, 'utf8')))
  const entries =
    typeof appDataPath === 'string' ? [{ executablePath: exe, dataPath: appDataPath }] : (appDataPath ?? [])
  const exact = entries.find((entry) => sameLocation(entry.executablePath, exe))
  const candidates = exact
    ? [exact]
    : isPortableExecutable(exe)
      ? []
      : entries.filter((entry) => !isPortableExecutable(entry.executablePath))
  for (const entry of candidates) {
    if (sameLocation(entry.dataPath, current)) continue
    if (!path.isAbsolute(entry.dataPath) || !isUsableDataDir(entry.dataPath)) {
      throw new Error(`Data directory unavailable: ${entry.dataPath}`)
    }
    const candidate = inspectLegacyProfile(entry.dataPath)
    if (candidate !== 'fresh') return { kind: candidate === 'ready' ? 'recover' : 'legacy', path: entry.dataPath }
  }
  return undefined
}
