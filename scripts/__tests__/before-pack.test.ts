/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import { readFileSync } from 'node:fs'
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
} from '../before-pack'

const hostPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
const foreignPlatform = hostPlatform === 'darwin' ? 'win32' : 'darwin'
const legacyMacOcrVersion = '1.0.2'
const macOcrPackages = ['@napi-rs/system-ocr-darwin-arm64', '@napi-rs/system-ocr-darwin-x64']

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
    expect(config.win.signtoolOptions.sign).toBe('scripts/win-sign.js')
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

  it('pins macOS system OCR to the legacy Accurate implementation', () => {
    const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      optionalDependencies: Record<string, string>
    }
    const workspaceConfig = parse(readFileSync('pnpm-workspace.yaml', 'utf8')) as {
      overrides: Record<string, string>
    }

    for (const packageName of macOcrPackages) {
      expect(packageManifest.optionalDependencies[packageName]).toBe(legacyMacOcrVersion)
      expect(workspaceConfig.overrides[packageName]).toBe(legacyMacOcrVersion)
    }
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
          config: {
            electronVersion: '41.8.0',
            electronDownload: { mirror: 'https://npmmirror.com/mirrors/electron/' }
          }
        }
      },
      rebuild
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

describe('keepPackages', () => {
  it.each([
    ['x64', '@deepseek-ai/node-addon-landlock-run-linux-x64', '@deepseek-ai/node-addon-landlock-run-linux-arm64'],
    ['arm64', '@deepseek-ai/node-addon-landlock-run-linux-arm64', '@deepseek-ai/node-addon-landlock-run-linux-x64']
  ] as const)('keeps only the Linux %s Landlock executable', (arch, matchingPackage, otherArchPackage) => {
    const keptPackages = keepPackages('linux', arch)

    expect(keptPackages).toContain(matchingPackage)
    expect(keptPackages).not.toContain(otherArchPackage)
  })

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
