/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
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
import { prepareWindowsRuntimeFloor } from '../packaging/windows-vc-runtime'

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
    ['mac', Arch.arm64, 'darwin', 'arm64'],
    ['windows', Arch.x64, 'win32', 'x64']
  ])('does not reuse the %s binary mirror for headers', async (platformName, arch, platform, archName) => {
    const rebuild = vi.fn(async () => {})

    await prepareNativeModulesForElectron(
      {
        arch,
        packager: {
          platform: { name: platformName },
          info: { buildResourcesDir: 'fixture-build' },
          config: {
            electronVersion: '41.8.0',
            electronDownload: { mirror: 'https://npmmirror.com/mirrors/electron/' }
          }
        }
      },
      rebuild,
      undefined,
      () => {}
    )

    expect(rebuild).toHaveBeenCalledWith({
      buildPath: path.resolve(import.meta.dirname, '../..'),
      electronVersion: '41.8.0',
      platform,
      arch: archName,
      onlyModules: ['better-sqlite3'],
      force: true,
      buildFromSource: true
    })
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

describe('Windows runtime preparation ordering', () => {
  const context = (buildResourcesDir, arch = Arch.x64) => ({
    arch,
    packager: { platform: { name: 'windows' }, config: { electronVersion: '41.8.0' }, info: { buildResourcesDir } }
  })

  it('rejects preparation without starting a native rebuild', async () => {
    let rebuilt = false
    await expect(
      prepareNativeModulesForElectron(
        context('unused'),
        async () => {
          rebuilt = true
        },
        undefined,
        () => {
          throw new Error('unverified floor')
        }
      )
    ).rejects.toThrow('unverified floor')
    expect(rebuilt).toBe(false)
  })

  it.each([Arch.x64, Arch.arm64])('writes the common include before rebuilding %s', async (arch) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-hook-'))
    try {
      let observed
      await prepareNativeModulesForElectron(
        context(dir, arch),
        async () => {
          observed = fs.readFileSync(path.join(dir, 'vc-runtime-version.generated.nsh'), 'utf8')
        },
        undefined,
        (options) =>
          prepareWindowsRuntimeFloor(options, {
            hostPlatform: 'win32',
            inspect: () => ({
              toolsets: [{ path: 'tools', version: '14.44.35207' }],
              redists: ['x64', 'arm64'].map((arch) => ({ path: arch, arch, version: [14, 44, 35211, 0] }))
            })
          })
      )
      expect(observed).toBe(
        '!define VC_RUNTIME_MIN_MAJOR 14\n!define VC_RUNTIME_MIN_MINOR 44\n!define VC_RUNTIME_MIN_BUILD 35211\n!define VC_RUNTIME_MIN_PACKED 917548\n'
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a Windows target on a non-Windows host before rebuilding', async () => {
    let rebuilt = false
    await expect(
      prepareNativeModulesForElectron(
        context('unused'),
        async () => {
          rebuilt = true
        },
        undefined,
        (options) => prepareWindowsRuntimeFloor(options, { hostPlatform: 'darwin' })
      )
    ).rejects.toThrow(
      'VC runtime floor generation failed: Windows-target packaging requires a Windows host; cannot verify MSVC on darwin.'
    )
    expect(rebuilt).toBe(false)
  })

  it('rejects unsupported Windows target architectures before preparation or rebuild', async () => {
    await expect(
      prepareNativeModulesForElectron(
        context('unused', Arch.ia32),
        async () => {
          throw new Error('unexpected rebuild')
        },
        undefined,
        () => {
          throw new Error('unexpected preparation')
        }
      )
    ).rejects.toThrow('Unsupported Windows packaging architecture:')
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
