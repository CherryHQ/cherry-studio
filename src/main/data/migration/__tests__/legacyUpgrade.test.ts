import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { LegacyFileCleanupPolicySeeder } from '@data/db/seeding/seeders/legacyFileCleanupPolicySeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import type * as UserDataLocationModule from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'

import { findLegacyUpgradeProfile, getLegacyUpgradeDownloadUrl, inspectLegacyProfile } from '../legacyUpgrade'
import { MIGRATION_V2_STATUS, readMigrationV2CompletedAt } from '../migrationStatus'
import { isMigratedFromV1 } from '../v1MigrationOrigin'

vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { get: vi.fn() } }))
vi.mock('@main/core/preboot/userDataLocation', async (importOriginal) => ({
  ...(await importOriginal<typeof UserDataLocationModule>()),
  getNormalizedExecutablePath: () => '/app/cherry'
}))

describe('legacy profile detection', () => {
  const dbh = setupTestDatabase()
  let root: string
  let profile: string
  let configFile: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-upgrade-'))
    profile = path.join(root, 'profile')
    configFile = path.join(root, 'legacy-config.json')
    fs.mkdirSync(profile)
    vi.spyOn(application, 'getPath').mockImplementation((key) => (key === 'v1.home_config_file' ? configFile : profile))
    vi.mocked(bootConfigService.get).mockReturnValue(null)
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function copyDatabase(value?: unknown) {
    if (value !== undefined) dbh.db.insert(appStateTable).values({ key: MIGRATION_V2_STATUS, value }).run()
    fs.mkdirSync(path.join(profile, 'Data'))
    await dbh.sqlite.backup(path.join(profile, 'Data/cherrystudio.sqlite'))
  }

  it('leaves a fresh profile empty and does not create a database', () => {
    expect(findLegacyUpgradeProfile()).toBeUndefined()
    expect(fs.readdirSync(profile)).toEqual([])
  })

  it.each(['version.log', 'config.json', 'chromium'])('blocks a legacy %s profile without altering it', (marker) => {
    if (marker === 'chromium') {
      fs.mkdirSync(path.join(profile, 'IndexedDB'))
      fs.mkdirSync(path.join(profile, 'Local Storage'))
    } else {
      fs.writeFileSync(path.join(profile, marker), marker === 'config.json' ? '{"theme":"dark"}' : '1.9.0')
    }
    const before = fs.readdirSync(profile)
    expect(findLegacyUpgradeProfile()).toEqual({ kind: 'legacy', path: profile })
    expect(fs.readdirSync(profile)).toEqual(before)
    expect(fs.existsSync(path.join(profile, 'Data'))).toBe(false)
  })

  it('accepts completed migration despite legacy residue and preserves the marker', async () => {
    const value = { status: 'completed', migratedFromV1: true, completedAt: 1234 }
    await copyDatabase(value)
    fs.writeFileSync(path.join(profile, 'version.log'), '1.9.0')
    const file = path.join(profile, 'Data/cherrystudio.sqlite')
    const before = fs.readFileSync(file)
    expect(findLegacyUpgradeProfile()).toBeUndefined()
    expect(fs.readFileSync(file)).toEqual(before)
    expect(isMigratedFromV1()).toBe(true)
    expect(readMigrationV2CompletedAt(dbh.db)).toBe(1234)
  })

  it('accepts a v2 database created after conversion retirement without a migration marker', async () => {
    new SeedRunner(dbh.db).runAll([new LegacyFileCleanupPolicySeeder()])
    await copyDatabase()
    fs.writeFileSync(path.join(profile, 'version.log'), '2.2.0')
    expect(findLegacyUpgradeProfile()).toBeUndefined()
    expect(isMigratedFromV1()).toBe(false)
  })

  it('blocks a converter crash after schema creation but before the first status record', async () => {
    await copyDatabase()
    fs.writeFileSync(path.join(profile, 'version.log'), '1.9.12')
    expect(findLegacyUpgradeProfile()).toEqual({ kind: 'legacy', path: profile })
    expect(dbh.db.select().from(appStateTable).all()).toEqual([])
  })

  it.each(['failed', 'in_progress'])('blocks %s conversion without changing persisted data', async (status) => {
    await copyDatabase({ status })
    const file = path.join(profile, 'Data/cherrystudio.sqlite')
    const before = fs.readFileSync(file)
    expect(findLegacyUpgradeProfile()).toEqual({ kind: 'legacy', path: profile })
    expect(fs.readFileSync(file)).toEqual(before)
    expect(isMigratedFromV1()).toBe(false)
  })

  it('does not mistake an empty SQLite file for migrated data', () => {
    fs.mkdirSync(path.join(profile, 'Data'))
    fs.writeFileSync(path.join(profile, 'Data/cherrystudio.sqlite'), '')
    fs.writeFileSync(path.join(profile, 'version.log'), '1.9.0')
    expect(inspectLegacyProfile(profile)).toBe('legacy')
  })

  it('fails closed on a corrupt database', () => {
    fs.mkdirSync(path.join(profile, 'Data'))
    fs.writeFileSync(path.join(profile, 'Data/cherrystudio.sqlite'), 'corrupt database')
    expect(() => findLegacyUpgradeProfile()).toThrow()
  })

  it('fails closed on malformed migration status', async () => {
    await copyDatabase({ status: 'unknown' })
    expect(() => findLegacyUpgradeProfile()).toThrow()
  })

  it.each(['string', 'exact', 'other-executable'])(
    'finds a custom legacy directory from %s config without redirecting it',
    (shape) => {
      const custom = path.join(root, 'custom')
      fs.mkdirSync(custom)
      fs.writeFileSync(path.join(custom, 'version.log'), '1.9.0')
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          appDataPath:
            shape === 'string'
              ? custom
              : [{ executablePath: shape === 'exact' ? '/app/cherry' : '/old/cherry', dataPath: custom }]
        })
      )
      expect(findLegacyUpgradeProfile()).toEqual({ kind: 'legacy', path: custom })
      expect(fs.readdirSync(profile)).toEqual([])
      expect(fs.readdirSync(custom)).toEqual(['version.log'])
    }
  )

  it.each(['completed', 'seeded'])(
    'recovers an established %s custom profile without modifying its database',
    async (state) => {
      if (state === 'seeded') new SeedRunner(dbh.db).runAll([new LegacyFileCleanupPolicySeeder()])
      await copyDatabase(state === 'completed' ? { status: 'completed', migratedFromV1: true } : undefined)
      const custom = path.join(root, 'custom')
      fs.renameSync(profile, custom)
      fs.mkdirSync(profile)
      fs.writeFileSync(configFile, JSON.stringify({ appDataPath: custom }))
      const file = path.join(custom, 'Data/cherrystudio.sqlite')
      const before = fs.readFileSync(file)
      expect(findLegacyUpgradeProfile()).toEqual({ kind: 'recover', path: custom })
      expect(fs.readFileSync(file)).toEqual(before)
      expect(fs.readdirSync(profile)).toEqual([])
    }
  )

  it('does not fall back to a fresh profile when the configured path is unavailable', () => {
    vi.mocked(bootConfigService.get).mockReturnValue({ '/app/cherry': path.join(root, 'missing') })
    expect(() => findLegacyUpgradeProfile()).toThrow('Data directory unavailable')
  })

  it('does not fall back when a legacy custom path is unavailable', () => {
    fs.writeFileSync(configFile, JSON.stringify({ appDataPath: path.join(root, 'missing') }))
    expect(() => findLegacyUpgradeProfile()).toThrow('Data directory unavailable')
    expect(fs.readdirSync(profile)).toEqual([])
  })

  it('does not inspect production legacy config during a development launch', () => {
    Object.defineProperty(app, 'isPackaged', { configurable: true, value: false })
    fs.writeFileSync(configFile, 'invalid json')
    expect(findLegacyUpgradeProfile()).toBeUndefined()
  })
})

describe('fixed migration release downloads', () => {
  it.each([
    ['darwin', 'x64', false, false, 'x64.dmg'],
    ['darwin', 'x64', true, false, 'arm64.dmg'],
    ['win32', 'x64', false, false, 'x64-setup.exe'],
    ['win32', 'arm64', false, true, 'arm64-portable.exe'],
    ['linux', 'x64', false, false, 'x86_64.AppImage'],
    ['linux', 'arm64', false, false, 'arm64.AppImage']
  ] as const)('selects prerequisite installer for %s/%s', (platform, arch, translated, portable, asset) => {
    expect(getLegacyUpgradeDownloadUrl({ platform, arch, translated, portable, version: '1.9.12' })).toBe(
      `https://github.com/CherryHQ/cherry-studio/releases/download/v1.9.12/Cherry-Studio-1.9.12-${asset}`
    )
  })

  it.each([
    ['darwin', 'x64', false, false, 'mac-x64.dmg'],
    ['darwin', 'arm64', false, false, 'mac-arm64.dmg'],
    ['darwin', 'x64', true, false, 'mac-arm64.dmg'],
    ['win32', 'x64', false, false, 'win-x64-setup.exe'],
    ['win32', 'arm64', false, false, 'win-arm64-setup.exe'],
    ['win32', 'x64', true, false, 'win-arm64-setup.exe'],
    ['win32', 'x64', false, true, 'win-x64-portable.exe'],
    ['win32', 'arm64', false, true, 'win-arm64-portable.exe'],
    ['linux', 'x64', false, false, 'linux-x64.AppImage'],
    ['linux', 'arm64', false, false, 'linux-arm64.AppImage']
  ] as const)('selects %s/%s translated=%s portable=%s', (platform, arch, translated, portable, asset) => {
    expect(getLegacyUpgradeDownloadUrl({ platform, arch, translated, portable })).toBe(
      `https://github.com/CherryHQ/cherry-studio/releases/download/v2.1.0/Cherry-Studio-2.1.0-${asset}`
    )
  })
})
