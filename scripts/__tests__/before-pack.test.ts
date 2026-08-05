/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// CJS build script — vitest interops the module.exports fine.
import { assertClaudeAgentSdkNativeVersion, assertPrebuiltPackages } from '../before-pack'

const hostPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
const foreignPlatform = hostPlatform === 'darwin' ? 'win32' : 'darwin'
const legacyMacOcrVersion = '1.0.2'
const macOcrPackages = ['@napi-rs/system-ocr-darwin-arm64', '@napi-rs/system-ocr-darwin-x64']
const nestedClaudeCliFilter =
  '!node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-*/**'

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

  it('excludes only nested Claude Agent SDK native binaries', () => {
    const builderConfig = parse(readFileSync('electron-builder.yml', 'utf8')) as { files: string[] }

    expect(builderConfig.files).toContain(nestedClaudeCliFilter)
    expect(builderConfig.files).not.toContain('!node_modules/@anthropic-ai/claude-agent-sdk-*/**')
  })

  it('rejects a native Claude binary from a different SDK release', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'cherry-claude-sdk-'))
    const sdkPackage = '@anthropic-ai/claude-agent-sdk'
    const nativePackage = `${sdkPackage}-${hostPlatform}-arm64`

    try {
      for (const [packageName, version] of [
        [sdkPackage, '0.3.185'],
        [nativePackage, '0.3.168']
      ]) {
        const packageDirectory = path.join(fixtureRoot, 'node_modules', ...packageName.split('/'))
        mkdirSync(packageDirectory, { recursive: true })
        writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: packageName, version }))
      }

      expect(() => assertClaudeAgentSdkNativeVersion(hostPlatform, 'arm64', fixtureRoot)).toThrow(
        /Mismatched Claude Agent SDK packages.*0\.3\.185.*0\.3\.168/
      )
    } finally {
      rmSync(fixtureRoot, { recursive: true })
    }
  })
})
