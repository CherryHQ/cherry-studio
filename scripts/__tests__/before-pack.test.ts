/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Arch } from 'electron-builder'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

// CJS build script — vitest interops the module.exports fine.
import {
  assertPrebuiltPackages,
  keepPackages,
  prepareNativeModulesForElectron,
  prepareSystemSpeechHelper
} from '../packaging/before-pack'

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
        from: 'packages/system-speech/dist/native/win32-x64/cherry-system-speech.exe',
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
