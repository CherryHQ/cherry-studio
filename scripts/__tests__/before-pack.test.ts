/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Arch } from 'electron-builder'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

// CJS build script — vitest interops the module.exports fine.
import {
  assertPrebuiltPackages,
  isWin7Packaging,
  keepPackages,
  prepareNativeModulesForElectron,
  prepareSystemSpeechHelper,
  prepareWin7NativeAddons,
  resolveElectronHeaderUrl,
  WIN7_PREBUILT_ADDONS
} from '../packaging/before-pack'

const require = createRequire(import.meta.url)

const hostPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
const foreignPlatform = hostPlatform === 'darwin' ? 'win32' : 'darwin'

describe('prepareSystemSpeechHelper', () => {
  it('ships the x64 helper once and removes it before an ARM64 packaging pass', () => {
    const config = parse(readFileSync('electron-builder.yml', 'utf8'))
    const originalResources = [...config.win.extraResources]
    const context = { arch: Arch.x64, packager: { platform: { name: 'windows' }, config } }
    const build = vi.fn()

    prepareSystemSpeechHelper(context, build)
    prepareSystemSpeechHelper(context, build)
    expect(config.win.extraResources).toEqual([
      ...originalResources,
      {
        from: 'native/system-speech/dist/native/win32-x64/cherry-system-speech.exe',
        to: 'system-speech/cherry-system-speech.exe'
      }
    ])

    context.arch = Arch.arm64
    prepareSystemSpeechHelper(context, () => {
      throw new Error('ARM64 must not build an x64 helper')
    })
    expect(config.win.extraResources).toEqual(originalResources)
    expect(config.win.signtoolOptions.sign).toBe('scripts/packaging/win-sign.js')
  })

  it('fails an x64 package when native compilation fails', () => {
    const config = parse(readFileSync('electron-builder.yml', 'utf8'))
    const context = { arch: Arch.x64, packager: { platform: { name: 'windows' }, config } }
    expect(() =>
      prepareSystemSpeechHelper(context, () => {
        throw new Error('native compilation failed')
      })
    ).toThrow('native compilation failed')
    expect(config.win.extraResources.some((resource: { to: string }) => resource.to.startsWith('system-speech/'))).toBe(
      false
    )
  })
})

describe('assertPrebuiltPackages', () => {
  it.each(['arm64', 'x64'])('passes for the host platform on %s', (arch) => {
    expect(() => assertPrebuiltPackages(hostPlatform, arch)).not.toThrow()
  })

  it('reports the missing packages by name', () => {
    // Only the host OS's binaries are installed (supportedArchitectures.os is `current`),
    // so another platform stands in for an install that skipped an architecture.
    expect(() => assertPrebuiltPackages(foreignPlatform, 'x64')).toThrow(
      /Missing prebuilt packages for .+-x64: .*@img\/sharp-/
    )
  })
})

describe('prepareNativeModulesForElectron', () => {
  it.each([
    ['mac', Arch.arm64, 'darwin-arm64'],
    ['windows', Arch.x64, 'win32-x64']
  ])('replaces the preferred %s prebuild with the source output', async (platformName, arch, target) => {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'sqlite-rebuild-'))
    const moduleDir = path.join(projectDir, 'node_modules/better-sqlite3')
    const previous = process.env.npm_package_config_node_gyp_force_build
    mkdirSync(path.join(moduleDir, 'prebuilds'), { recursive: true })
    writeFileSync(path.join(moduleDir, 'package.json'), '{"name":"better-sqlite3"}')
    writeFileSync(path.join(moduleDir, `prebuilds/${target}.node`), 'bundled')
    writeFileSync(path.join(moduleDir, 'prebuilds/linux-x64.node'), 'other-target')
    const context = {
      arch,
      packager: { projectDir, platform: { name: platformName }, config: { electronVersion: '45.2.2' } }
    }
    try {
      await prepareNativeModulesForElectron(context, async () => {
        if (process.env.npm_package_config_node_gyp_force_build !== '1') return
        mkdirSync(path.join(moduleDir, 'build/Release'), { recursive: true })
        writeFileSync(path.join(moduleDir, 'build/Release/better_sqlite3.node'), 'compiled')
      })
      expect(readFileSync(path.join(moduleDir, `prebuilds/${target}.node`), 'utf8')).toBe('compiled')
      expect(readFileSync(path.join(moduleDir, 'prebuilds/linux-x64.node'), 'utf8')).toBe('other-target')
      expect(process.env.npm_package_config_node_gyp_force_build).toBe(previous)

      await expect(
        prepareNativeModulesForElectron(context, async () => {
          throw new Error('compiler failed')
        })
      ).rejects.toThrow('compiler failed')
      expect(process.env.npm_package_config_node_gyp_force_build).toBe(previous)
      expect(readFileSync(path.join(moduleDir, `prebuilds/${target}.node`), 'utf8')).toBe('compiled')
      await expect(prepareNativeModulesForElectron(context, async () => {})).rejects.toThrow('ENOENT')
      expect(process.env.npm_package_config_node_gyp_force_build).toBe(previous)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it.each([
    [Arch.arm64, 'arm64'],
    [Arch.x64, 'x64']
  ])('uses the pinned Linux artifact for %s without rebuilding', async (arch, archName) => {
    const rebuild = vi.fn(async () => {})
    const ensureLinuxArtifact = vi.fn(() => ({
      cached: true,
      inspection: { sha256: 'sha256' }
    }))

    await prepareNativeModulesForElectron(
      {
        arch,
        packager: {
          projectDir: path.resolve(import.meta.dirname, '../..'),
          platform: { name: 'linux' },
          config: { electronVersion: '41.8.0' }
        }
      },
      rebuild,
      ensureLinuxArtifact
    )

    expect(ensureLinuxArtifact).toHaveBeenCalledWith({
      projectRoot: path.resolve(import.meta.dirname, '../..'),
      arch: archName
    })
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('passes electron-legacy headerURL when packaging win7 and omits it for mac12', async () => {
    const win7Config = require('../../electron-builder.win7.config.cjs')
    const mac12Config = require('../../electron-builder.mac12.config.cjs')
    const projectDir = mkdtempSync(path.join(tmpdir(), 'sqlite-legacy-rebuild-'))
    const moduleDir = path.join(projectDir, 'node_modules/better-sqlite3')
    mkdirSync(path.join(moduleDir, 'prebuilds'), { recursive: true })
    writeFileSync(path.join(moduleDir, 'package.json'), '{"name":"better-sqlite3"}')

    try {
      const win7Rebuild = vi.fn(async () => {
        mkdirSync(path.join(moduleDir, 'build/Release'), { recursive: true })
        writeFileSync(path.join(moduleDir, 'build/Release/better_sqlite3.node'), 'win7-compiled')
      })
      await prepareNativeModulesForElectron(
        {
          arch: Arch.x64,
          packager: { projectDir, platform: { name: 'windows' }, config: win7Config }
        },
        win7Rebuild
      )
      expect(win7Rebuild).toHaveBeenCalledWith(
        expect.objectContaining({
          electronVersion: win7Config.electronVersion,
          platform: 'win32',
          arch: 'x64',
          headerURL: 'https://thorium.rocks/electron-legacy/headers'
        })
      )

      const mac12Rebuild = vi.fn(async () => {
        mkdirSync(path.join(moduleDir, 'build/Release'), { recursive: true })
        writeFileSync(path.join(moduleDir, 'build/Release/better_sqlite3.node'), 'mac12-compiled')
      })
      await prepareNativeModulesForElectron(
        {
          arch: Arch.arm64,
          packager: { projectDir, platform: { name: 'mac' }, config: mac12Config }
        },
        mac12Rebuild
      )
      expect(mac12Rebuild).toHaveBeenCalledWith(
        expect.not.objectContaining({
          headerURL: expect.anything()
        })
      )
      expect(mac12Rebuild).toHaveBeenCalledWith(
        expect.objectContaining({
          electronVersion: mac12Config.electronVersion,
          platform: 'darwin',
          arch: 'arm64'
        })
      )
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})

describe('legacy electron-builder configs and header resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers CHERRY_ELECTRON_HEADER_URL over mirror auto-detection', () => {
    const win7Config = require('../../electron-builder.win7.config.cjs')
    const mac12Config = require('../../electron-builder.mac12.config.cjs')

    expect(resolveElectronHeaderUrl({ packager: { platform: { name: 'windows' }, config: win7Config } })).toBe(
      'https://thorium.rocks/electron-legacy/headers'
    )
    expect(resolveElectronHeaderUrl({ packager: { platform: { name: 'mac' }, config: mac12Config } })).toBeUndefined()

    vi.stubEnv('CHERRY_ELECTRON_HEADER_URL', 'https://headers.example.test/electron')
    expect(resolveElectronHeaderUrl({ packager: { platform: { name: 'mac' }, config: mac12Config } })).toBe(
      'https://headers.example.test/electron'
    )
  })

  it('exposes valid win7 and mac12 packaging configs', () => {
    const win7Config = require('../../electron-builder.win7.config.cjs')
    const mac12Config = require('../../electron-builder.mac12.config.cjs')

    expect(win7Config).toMatchObject({
      extends: './electron-builder.yml',
      electronVersion: '44.11.6',
      npmRebuild: false,
      electronDownload: {
        mirror: 'https://github.com/Alex313031/electron-legacy/releases/download/',
        customDir: 'v44.11.6'
      },
      nsis: {
        include: 'build/nsis-installer-win7.nsh'
      }
    })

    expect(mac12Config).toMatchObject({
      extends: './electron-builder.yml',
      electronVersion: '43.8.13',
      npmRebuild: false,
      mac: {
        minimumSystemVersion: '12.0.0'
      }
    })
  })

  it('substitutes Win7-compatible pre-Rust-1.78 native addons and CLI tools only during Win7 x64 packaging', async () => {
    const win7Config = require('../../electron-builder.win7.config.cjs')
    const mac12Config = require('../../electron-builder.mac12.config.cjs')
    const { resolveToolsForTarget, TOOLS, WIN7_TOOL_OVERRIDES } = require('../download-binaries')

    const win7Context = {
      arch: Arch.x64,
      packager: { projectDir: '/repo', platform: { name: 'windows' }, config: win7Config }
    }
    const mac12Context = {
      arch: Arch.arm64,
      packager: { projectDir: '/repo', platform: { name: 'mac' }, config: mac12Config }
    }

    expect(isWin7Packaging(win7Context)).toBe(true)
    expect(isWin7Packaging(mac12Context)).toBe(false)

    const installedAddons: string[] = []
    await prepareWin7NativeAddons(win7Context, async (addon: { packageName: string; version: string }) => {
      installedAddons.push(`${addon.packageName}@${addon.version}`)
    })
    expect(installedAddons).toEqual([
      '@node-rs/xxhash-win32-x64-msvc@1.7.0',
      'node-screenshots-win32-x64-msvc@0.2.0',
      '@napi-rs/canvas-win32-x64-msvc@0.1.52'
    ])
    expect(WIN7_PREBUILT_ADDONS).toHaveLength(3)

    const macAddons: string[] = []
    await prepareWin7NativeAddons(mac12Context, async (addon: { packageName: string }) => {
      macAddons.push(addon.packageName)
    })
    expect(macAddons).toEqual([])

    const defaultTools = resolveToolsForTarget({ win7: false })
    expect(defaultTools).toBe(TOOLS)

    const win7Tools = resolveToolsForTarget({ win7: true })
    const win7Rg = win7Tools.find((t: { name: string }) => t.name === 'rg')
    const win7Mingit = win7Tools.find((t: { name: string }) => t.name === 'mingit')
    expect(win7Rg.version).toBe(WIN7_TOOL_OVERRIDES.rg.version)
    expect(win7Rg.packages['win32-x64'].sha256).toBe(WIN7_TOOL_OVERRIDES.rg.packages['win32-x64'].sha256)
    expect(win7Mingit.version).toBe(WIN7_TOOL_OVERRIDES.mingit.version)
    expect(win7Mingit.packages['win32-x64'].sha256).toBe(WIN7_TOOL_OVERRIDES.mingit.packages['win32-x64'].sha256)
  })
})

describe('keepPackages', () => {
  // The name matcher keys off arch and platform tokens, and this package name carries
  // neither. Left to it, a Mac build would drop the module the permission prompt needs,
  // and a Windows or Linux build cross-made on a Mac would ship its darwin-only `.node`.
  it.each(['arm64', 'x64'])('keeps the arch-agnostic macOS permission module on darwin %s', (arch) => {
    expect(keepPackages('darwin', arch)).toContain('node-mac-permissions')
  })

  it.each(['win32', 'linux'])('drops it on %s, which is what excludes it from the package', (platform) => {
    expect(keepPackages(platform, 'x64')).not.toContain('node-mac-permissions')
  })
})
