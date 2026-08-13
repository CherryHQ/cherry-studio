/**
 * Guards the prebuilt-package check in before-pack.js. CI never runs electron-builder,
 * so this is the only place the check is exercised: it fails here if `pnpm install`
 * stopped materialising both CPU architectures for the host OS — the packaging bug that
 * shipped a macOS x64 build without `@img/sharp-darwin-x64`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// CJS build script — vitest interops the module.exports fine.
import {
  assertClaudeAgentSdkNativeVersion,
  assertPrebuiltPackages,
  bundleClaudeAgentSdk,
  claudeNativePackageName
} from '../before-pack'

const hostPlatform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
const foreignPlatform = hostPlatform === 'darwin' ? 'win32' : 'darwin'
const legacyMacOcrVersion = '1.0.2'
const macOcrPackages = ['@napi-rs/system-ocr-darwin-arm64', '@napi-rs/system-ocr-darwin-x64']
const tmpDirs: string[] = []

function makeTmpDir(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(directory)
  return directory
}

function writePackage(projectRoot: string, packageName: string, version: string, binaryName?: string): void {
  const packageDirectory = path.join(projectRoot, 'node_modules', packageName)
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: packageName, version }), 'utf8')
  if (binaryName) writeFileSync(path.join(packageDirectory, binaryName), `claude-${version}`, 'utf8')
}

afterEach(() => {
  for (const directory of tmpDirs) rmSync(directory, { recursive: true, force: true })
  tmpDirs.length = 0
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

describe('Claude Agent SDK payload', () => {
  it.each(['arm64', 'x64'])('has a matching installed native SDK version for the host platform on %s', (arch) => {
    expect(() => assertClaudeAgentSdkNativeVersion(hostPlatform, arch)).not.toThrow()
  })

  it.each([
    ['darwin', 'arm64', '@anthropic-ai/claude-agent-sdk-darwin-arm64'],
    ['darwin', 'x64', '@anthropic-ai/claude-agent-sdk-darwin-x64'],
    ['linux', 'arm64', '@anthropic-ai/claude-agent-sdk-linux-arm64'],
    ['linux', 'x64', '@anthropic-ai/claude-agent-sdk-linux-x64'],
    ['win32', 'arm64', '@anthropic-ai/claude-agent-sdk-win32-arm64'],
    ['win32', 'x64', '@anthropic-ai/claude-agent-sdk-win32-x64']
  ])('maps %s-%s to its native package', (platform, arch, packageName) => {
    expect(claudeNativePackageName(platform, arch)).toBe(packageName)
  })

  it('requires the JavaScript and native packages to have exactly the same version', () => {
    const projectRoot = makeTmpDir('before-pack-claude-mismatch-')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk', '1.2.3')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk-darwin-arm64', '1.2.4', 'claude')

    expect(() => assertClaudeAgentSdkNativeVersion('darwin', 'arm64', { projectRoot })).toThrow(/1\.2\.3 != .*1\.2\.4/)
  })

  it('fails when the matching native executable is missing', () => {
    const projectRoot = makeTmpDir('before-pack-claude-missing-')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk', '1.2.3')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk-linux-x64', '1.2.3')

    expect(() => assertClaudeAgentSdkNativeVersion('linux', 'x64', { projectRoot })).toThrow(/native binary missing/)
  })

  it('writes a versioned Zstd payload without changing the installed SDK binary', async () => {
    const projectRoot = makeTmpDir('before-pack-claude-bundle-')
    const resourcesDir = makeTmpDir('before-pack-claude-resources-')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk', '1.2.3')
    writePackage(projectRoot, '@anthropic-ai/claude-agent-sdk-darwin-arm64', '1.2.3', 'claude')

    const artifact = await bundleClaudeAgentSdk('darwin', 'arm64', { projectRoot, resourcesDir })
    const archive = path.join(resourcesDir, 'darwin-arm64', artifact.files[0].archive)
    const manifest = JSON.parse(readFileSync(path.join(resourcesDir, 'darwin-arm64', 'manifest.json'), 'utf8'))

    expect(artifact).toMatchObject({ kind: 'files', version: '1.2.3' })
    expect(zstdDecompressSync(readFileSync(archive)).toString()).toBe('claude-1.2.3')
    expect(manifest.artifacts.claude).toEqual(artifact)
    expect(
      readFileSync(path.join(projectRoot, 'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'), 'utf8')
    ).toBe('claude-1.2.3')
  })
})
