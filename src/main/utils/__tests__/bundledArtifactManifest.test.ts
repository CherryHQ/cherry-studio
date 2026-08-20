import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ resourcesRoot: '' }))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn(() => state.resourcesRoot)
  }
}))

import {
  bundledArtifactArchivePath,
  readBundledArtifactManifest,
  readBundledArtifactManifestAt
} from '../bundledArtifactManifest'

const tmpDirs: string[] = []

function makeResourcesRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-manifest-'))
  tmpDirs.push(directory)
  state.resourcesRoot = directory
  return directory
}

function writeManifest(value: unknown, platform = 'linux', arch = 'x64'): void {
  const directory = path.join(state.resourcesRoot, `${platform}-${arch}`)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value), 'utf8')
}

afterEach(() => {
  for (const directory of tmpDirs) fs.rmSync(directory, { recursive: true, force: true })
  tmpDirs.length = 0
})

beforeEach(() => {
  makeResourcesRoot()
})

describe('readBundledArtifactManifest', () => {
  it('parses file and tree artifacts for the requested target', () => {
    writeManifest({
      schemaVersion: 2,
      platform: 'linux',
      arch: 'x64',
      artifacts: {
        mise: {
          kind: 'files',
          version: '1.0.0',
          files: [
            {
              output: 'mise',
              archive: 'mise.zst',
              compression: 'zstd',
              archiveSha256: 'a'.repeat(64),
              sha256: 'b'.repeat(64),
              size: 10,
              mode: 0o755
            }
          ]
        },
        mingit: {
          kind: 'tree',
          version: '2.0.0',
          compression: 'zstd',
          archive: 'mingit.tar.zst',
          archiveSha256: 'c'.repeat(64),
          sha256: 'd'.repeat(64),
          size: 20,
          entrypoints: ['git/cmd/git.exe'],
          files: [
            {
              path: 'git/cmd/git.exe',
              sha256: 'e'.repeat(64),
              size: 10,
              mode: 0o755
            }
          ]
        }
      }
    })

    const manifest = readBundledArtifactManifest('linux', 'x64')

    expect(manifest.artifacts.mise).toMatchObject({ kind: 'files', version: '1.0.0' })
    expect(manifest.artifacts.mingit).toMatchObject({ kind: 'tree', entrypoints: ['git/cmd/git.exe'] })
    expect(bundledArtifactArchivePath(manifest, 'mise.zst')).toBe(
      path.join(state.resourcesRoot, 'linux-x64', 'mise.zst')
    )
  })

  it('rejects a manifest for another platform or architecture', () => {
    writeManifest({ schemaVersion: 2, platform: 'darwin', arch: 'arm64', artifacts: {} })

    expect(() => readBundledArtifactManifest('linux', 'x64')).toThrow(/Invalid bundled artifact manifest/)
  })

  it.each(['../claude', '/tmp/claude', 'nested//claude'])('rejects unsafe payload path %s', (output) => {
    writeManifest({
      schemaVersion: 2,
      platform: 'linux',
      arch: 'x64',
      artifacts: {
        claude: {
          kind: 'files',
          version: '1.0.0',
          files: [
            {
              output,
              archive: 'claude.zst',
              compression: 'zstd',
              archiveSha256: 'a'.repeat(64),
              sha256: 'b'.repeat(64),
              size: 10,
              mode: 0o755
            }
          ]
        }
      }
    })

    expect(() => readBundledArtifactManifest('linux', 'x64')).toThrow(/Invalid bundled files artifact/)
  })

  it('rejects a tree whose entrypoint is absent from its declared file inventory', () => {
    writeManifest({
      schemaVersion: 2,
      platform: 'linux',
      arch: 'x64',
      artifacts: {
        mingit: {
          kind: 'tree',
          version: '2.0.0',
          compression: 'zstd',
          archive: 'mingit.tar.zst',
          archiveSha256: 'a'.repeat(64),
          sha256: 'b'.repeat(64),
          size: 20,
          entrypoints: ['git/cmd/git.exe'],
          files: [{ path: 'git/bin/bash.exe', sha256: 'c'.repeat(64), size: 10, mode: 0o755 }]
        }
      }
    })

    expect(() => readBundledArtifactManifest('linux', 'x64')).toThrow(/tree inventory/)
  })

  it('rejects colliding file outputs in one artifact', () => {
    writeManifest({
      schemaVersion: 2,
      platform: 'linux',
      arch: 'x64',
      artifacts: {
        runtime: {
          kind: 'files',
          version: '1.0.0',
          files: [
            {
              output: 'runtime',
              archive: 'runtime.zst',
              compression: 'zstd',
              archiveSha256: 'a'.repeat(64),
              sha256: 'b'.repeat(64),
              size: 10,
              mode: 0o755
            },
            {
              output: 'runtime/entry.js',
              archive: 'entry.zst',
              compression: 'zstd',
              archiveSha256: 'c'.repeat(64),
              sha256: 'd'.repeat(64),
              size: 10,
              mode: 0o755
            }
          ]
        }
      }
    })

    expect(() => readBundledArtifactManifest('linux', 'x64')).toThrow(/files inventory/)
  })

  it('reads a trusted manifest outside resources/binaries', () => {
    const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-manifest-root-'))
    tmpDirs.push(archiveRoot)
    const manifestPath = path.join(archiveRoot, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ schemaVersion: 2, platform: 'linux', arch: 'x64', artifacts: {} }),
      'utf8'
    )

    const manifest = readBundledArtifactManifestAt(manifestPath, 'linux', 'x64')

    expect(manifest.artifacts).toEqual({})
    expect(bundledArtifactArchivePath(manifest, 'runtime.tar.zst', archiveRoot)).toBe(
      path.join(archiveRoot, 'runtime.tar.zst')
    )
  })
})
