import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'
import { AppImageUpdater, DebUpdater, RpmUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { bootConfigService } from '@main/data/bootConfig'

import {
  createLegacyBridgeUpdater,
  getLegacyBridgeEligibility,
  prepareLegacyBridgeProfile,
  getLegacyLinuxPackageType
} from '../legacyBridgeInstaller'
import { findLegacyBridgeTarget } from '../legacyBridgeTarget'
import { getLegacyUpgradeDownloadUrl } from '../legacyUpgrade'

vi.mock('@main/data/bootConfig', () => ({ bootConfigService: { get: vi.fn(), set: vi.fn(), persist: vi.fn() } }))

describe('Linux bridge package continuity', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-linux-'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.stubEnv('APPIMAGE', undefined)
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', undefined)
    vi.spyOn(application, 'getPath').mockImplementation((_key, filename) =>
      filename ? path.join(root, filename) : root
    )
    vi.spyOn(app, 'getVersion').mockReturnValue('2.2.0')
    vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true)
    vi.mocked(bootConfigService.get).mockReturnValue(null)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ cherryEdition: 'global' }))
    fs.writeFileSync(path.join(root, 'version.log'), '1.9.12|linux|prod|packaged|install|2026-09-01T00:00:00.000Z')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.each([
    ['deb', DebUpdater],
    ['rpm', RpmUpdater]
  ] as const)('keeps a %s install on its package manager', (format, Updater) => {
    fs.writeFileSync(path.join(root, 'package-type'), `${format}\n`)
    const result = getLegacyBridgeEligibility(root)
    expect(result.prerequisite).toBe(false)
    expect(result.target?.url).toMatch(new RegExp(`linux-${process.arch}\\.${format}$`))
    const updater = createLegacyBridgeUpdater(result.target!)
    expect(updater).toBeInstanceOf(Updater)
    expect(updater.allowDowngrade).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(fs.readFileSync(path.join(root, 'version.log'), 'utf8')).toBe(
      '1.9.12|linux|prod|packaged|install|2026-09-01T00:00:00.000Z'
    )
  })

  it('prefers the running AppImage over a package marker', () => {
    const image = path.join(root, 'test.AppImage')
    fs.writeFileSync(image, '')
    fs.writeFileSync(path.join(root, 'package-type'), 'deb')
    vi.stubEnv('APPIMAGE', image)
    expect(getLegacyLinuxPackageType()).toBe('AppImage')
    expect(createLegacyBridgeUpdater(getLegacyBridgeEligibility(root).target!)).toBeInstanceOf(AppImageUpdater)
  })

  it.each([undefined, 'pacman', 'unknown'])('does not guess an installer from marker %s', (marker) => {
    if (marker) fs.writeFileSync(path.join(root, 'package-type'), marker)
    expect(getLegacyBridgeEligibility(root)).toEqual({ prerequisite: false })
  })

  it('supports discovered custom profiles but blocks older data', () => {
    fs.writeFileSync(path.join(root, 'package-type'), 'deb')
    vi.mocked(bootConfigService.get).mockReturnValue({ [app.getPath('exe')]: '/custom' })
    const custom = path.join(root, 'custom')
    fs.mkdirSync(custom)
    fs.copyFileSync(path.join(root, 'version.log'), path.join(custom, 'version.log'))
    expect(getLegacyBridgeEligibility(custom).target?.url).toContain('.deb')
    fs.writeFileSync(path.join(root, 'version.log'), '1.9.11|linux|prod|packaged|install|2026-09-01T00:00:00.000Z')
    expect(getLegacyBridgeEligibility(root)).toEqual({ prerequisite: true })
  })

  it('supports a configured custom profile when it is the active profile', () => {
    fs.writeFileSync(path.join(root, 'package-type'), 'deb')
    vi.mocked(bootConfigService.get).mockReturnValue({ [app.getPath('exe')]: root })
    expect(getLegacyBridgeEligibility(root).target?.url).toContain('.deb')
  })

  it.each(['x64', 'arm64'] as const)('selects a compatible Windows %s portable installer', (arch) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue(arch)
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', root)
    fs.writeFileSync(path.join(root, 'version.log'), '1.9.12|win|prod|packaged|portable|2026-09-01T00:00:00.000Z')
    expect(getLegacyBridgeEligibility(root).target?.url).toContain(`win-${arch}-portable.exe`)
    expect(getLegacyUpgradeDownloadUrl({ platform: 'win32', arch, translated: false, portable: true })).toBe(
      `https://github.com/CherryHQ/cherry-studio/releases/download/v2.1.0/Cherry-Studio-2.1.0-win-${arch}-portable.exe`
    )
  })

  it('advances a portable 1.9.11 profile only after 1.9.12 has recorded its launch', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', root)
    const exe = path.join(root, 'Cherry Studio Portable.exe')
    fs.writeFileSync(exe, '')
    const configFile = path.join(root, 'config.json')
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      if (key === 'app.portable_executable') return exe
      if (key === 'v1.home_config_file') return configFile
      return filename ? path.join(root, filename) : root
    })
    const profile = path.join(root, 'data')
    const version = path.join(profile, 'version.log')
    fs.mkdirSync(profile)
    fs.writeFileSync(version, '1.9.11|win|prod|packaged|portable|2026-09-01T00:00:00.000Z')
    expect(getLegacyBridgeEligibility(profile)).toMatchObject({ prerequisite: true, target: { version: '1.9.12' } })
    fs.writeFileSync(configFile, JSON.stringify({ appDataPath: root }))
    expect(getLegacyBridgeEligibility(profile)).toEqual({ prerequisite: true })
    fs.unlinkSync(configFile)
    fs.copyFileSync(version, path.join(root, 'version.log'))
    expect(getLegacyBridgeEligibility(root)).toEqual({ prerequisite: true })
    fs.appendFileSync(version, '\n1.9.12|win|prod|packaged|portable|2026-09-02T00:00:00.000Z')
    expect(getLegacyBridgeEligibility(profile)).toMatchObject({ prerequisite: false, target: { version: '2.1.0' } })
  })

  it('pins the selected custom directory only at handoff and restores the previous mapping on failure', () => {
    const previous = { '/another/executable': '/another/profile' }
    vi.mocked(bootConfigService.get).mockReturnValue(previous)
    const restore = prepareLegacyBridgeProfile(root)
    expect(vi.mocked(bootConfigService.set).mock.lastCall?.[1]).toEqual({ ...previous, [app.getPath('exe')]: root })
    restore()
    expect(vi.mocked(bootConfigService.set).mock.lastCall?.[1]).toEqual(previous)
  })

  it('refuses handoff if the selected profile disappears', () => {
    expect(() => prepareLegacyBridgeProfile(path.join(root, 'missing'))).toThrow('unavailable')
  })

  it.each(['global', 'cn'] as const)(
    'matches direct downloads and pinned %s assets across formats and architectures',
    (edition) => {
      for (const arch of ['x64', 'arm64']) {
        for (const format of ['deb', 'rpm'] as const) {
          const target = findLegacyBridgeTarget(edition, 'linux', arch, format)!
          const input = {
            platform: 'linux' as const,
            arch,
            translated: false,
            portable: false,
            edition,
            linuxPackageType: format
          }
          expect(getLegacyUpgradeDownloadUrl(input)).toBe(target.url)
          expect(Buffer.from(target.sha512, 'base64')).toHaveLength(64)
          const legacyArch =
            format === 'deb' ? (arch === 'x64' ? 'amd64' : 'arm64') : arch === 'x64' ? 'x86_64' : 'aarch64'
          expect(getLegacyUpgradeDownloadUrl({ ...input, version: '1.9.12' })).toBe(
            `https://github.com/CherryHQ/cherry-studio/releases/download/v1.9.12/Cherry-Studio-1.9.12-${legacyArch}.${format}`
          )
        }
      }
    }
  )
})
