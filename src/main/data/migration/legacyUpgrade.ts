import { randomUUID } from 'node:crypto'
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

import {
  LEGACY_PREREQUISITE_VERSION,
  LEGACY_UPGRADE_VERSION,
  type LegacyBridgeVersion,
  type LegacyLinuxPackageType
} from './legacyBridgeTarget'
import { MIGRATION_V2_STATUS, migrationStatusSchema } from './migrationStatus'

export function getLegacyUpgradeDownloadUrl({
  platform,
  arch,
  translated,
  portable,
  version = LEGACY_UPGRADE_VERSION,
  edition = 'global',
  linuxPackageType = 'AppImage'
}: {
  platform: NodeJS.Platform
  arch: string
  translated: boolean
  portable: boolean
  version?: LegacyBridgeVersion
  edition?: 'global' | 'cn'
  linuxPackageType?: LegacyLinuxPackageType
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
      asset = `linux-${nativeArch}.${linuxPackageType}`
      break
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
  if (version === LEGACY_PREREQUISITE_VERSION) {
    asset = asset.replace(/^(mac|win|linux)-/, '')
    if (platform === 'linux') {
      const legacyArch = {
        AppImage: { x64: 'x86_64', arm64: 'arm64' },
        deb: { x64: 'amd64', arm64: 'arm64' },
        rpm: { x64: 'x86_64', arm64: 'aarch64' }
      }[linuxPackageType][nativeArch]
      asset = `${legacyArch}.${linuxPackageType}`
    }
  }
  return `https://github.com/CherryHQ/cherry-studio/releases/download/v${version}/Cherry-Studio-${edition === 'cn' && version !== LEGACY_PREREQUISITE_VERSION ? 'CN-' : ''}${version}-${asset}`
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

const portableTrayBackupSchema = z.object({ configExisted: z.boolean(), trayOnClose: z.unknown().optional() })
const legacySettingsSchema = z.record(z.string(), z.unknown())

/** The original launcher can recover its legacy close setting after an interrupted portable handoff. */
export function restoreInterruptedPortableTraySetting(executable: string, profile: string): 'busy' | 'ready' {
  const config = getLegacyProfilePaths(profile).config
  const backup = config + '.portable-migration.json'
  try {
    if (statIfPresent(executable + '.update-lock')) return 'busy'
  } catch (error) {
    if (['EACCES', 'EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'busy'
    throw error
  }
  if (!statIfPresent(backup)) return 'ready'
  const saved = portableTrayBackupSchema.parse(JSON.parse(fs.readFileSync(backup, 'utf8')))
  const settings = statIfPresent(config) ? legacySettingsSchema.parse(JSON.parse(fs.readFileSync(config, 'utf8'))) : {}
  if (Object.hasOwn(saved, 'trayOnClose')) settings.trayOnClose = saved.trayOnClose
  else delete settings.trayOnClose
  if (saved.configExisted || Object.keys(settings).length) {
    const temporary = config + '.' + randomUUID() + '.tmp'
    try {
      fs.writeFileSync(temporary, JSON.stringify(settings), { flag: 'wx' })
      fs.renameSync(temporary, config)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  } else {
    fs.rmSync(config, { force: true })
  }
  fs.unlinkSync(backup)
  return 'ready'
}

export function isLegacyPortableDefaultProfile(profile: string, portableDir: string): boolean {
  if (!sameLocation(profile, path.join(portableDir, 'data'))) return false
  const configFile = application.getPath('v1.home_config_file')
  if (!statIfPresent(configFile)) return true
  const { appDataPath } = legacyConfigSchema.parse(JSON.parse(fs.readFileSync(configFile, 'utf8')))
  const executable = path.join(portableDir, 'cherry-studio-portable.exe')
  const configured =
    typeof appDataPath === 'string'
      ? appDataPath
      : appDataPath?.find((entry) => entry.executablePath === executable)?.dataPath
  return !configured || sameLocation(profile, configured)
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
