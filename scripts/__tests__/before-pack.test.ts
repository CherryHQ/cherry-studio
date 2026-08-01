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
import { assertPrebuiltPackages, keepPackages, rebuildNativeModulesForElectron } from '../before-pack'

const hostPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
const foreignPlatform = hostPlatform === 'darwin' ? 'win32' : 'darwin'
const legacyMacOcrVersion = '1.0.2'
const macOcrPackages = ['@napi-rs/system-ocr-darwin-arm64', '@napi-rs/system-ocr-darwin-x64']

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

describe('rebuildNativeModulesForElectron', () => {
  it.each([
    ['mac', Arch.arm64, 'darwin', 'arm64'],
    ['windows', Arch.x64, 'win32', 'x64']
  ])('forces better-sqlite3 for the %s target', async (platformName, arch, platform, archName) => {
    const rebuild = vi.fn(async () => {})

    await rebuildNativeModulesForElectron(
      {
        arch,
        packager: {
          platform: { name: platformName },
          config: { electronVersion: '41.8.0' }
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
