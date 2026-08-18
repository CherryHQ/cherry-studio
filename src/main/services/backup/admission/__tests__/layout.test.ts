import { describe, expect, it } from 'vitest'

import type { AdmissionRejectReason } from '../../errors'
import type { BackupManifest, ResourcePayload } from '../../manifest'
import type { ArchiveShape, NormalizedEntry } from '../catalog'
import { classifyPayloadLayout } from '../layout'

function entry(path: string, isDirectory: boolean): NormalizedEntry {
  return { path, isDirectory, uncompressedSize: 0, executable: false, zipEntry: null as never }
}

function shape(resourceFiles: string[], resourceDirs: string[] = []): ArchiveShape {
  return {
    manifest: entry('manifest.json', false),
    db: entry('backup.sqlite', false),
    resourceFiles: resourceFiles.map((p) => entry(p, false)),
    resourceDirs: resourceDirs.map((p) => entry(p, true)),
    declaredTotalBytes: 0
  }
}

function payload(archivePath: string, resourceType: 'file' | 'directory'): ResourcePayload {
  const common = { kind: 'k', archivePath, livePath: `Data/${archivePath}`, hash: '0'.repeat(64), sizeBytes: 0 }
  return resourceType === 'file' ? { ...common, resourceType, executable: false } : { ...common, resourceType }
}

const COMMON = {
  backupFormatVersion: 2 as const,
  createdAt: '2026-07-27T00:00:00.000Z',
  producer: { appVersion: '2.0.0', platform: 'darwin' as const, managedRoots: [] },
  migrationChain: [{ folderMillis: 1, hash: 'a' }],
  db: { hash: '0'.repeat(64), sizeBytes: 1 },
  resourceRequirements: [],
  degradations: []
}

function fullM(payloads: ResourcePayload[]): BackupManifest {
  return { ...COMMON, preset: 'full', resourcePayloads: payloads }
}

function reason(fn: () => unknown): AdmissionRejectReason | 'OK' {
  try {
    fn()
    return 'OK'
  } catch (err) {
    return (err as { reason: AdmissionRejectReason }).reason
  }
}

describe('classifyPayloadLayout — no declared payloads', () => {
  it('accepts an archive with no resource entries', () => {
    expect(reason(() => classifyPayloadLayout(shape([]), fullM([])))).toBe('OK')
  })
  it('rejects a resource file no payload declares', () => {
    expect(reason(() => classifyPayloadLayout(shape(['resources/x']), fullM([])))).toBe('layout')
  })
  it('rejects a resource directory no payload declares', () => {
    expect(reason(() => classifyPayloadLayout(shape([], ['resources/kb']), fullM([])))).toBe('layout')
  })
})

describe('classifyPayloadLayout — declared payloads', () => {
  it('accepts a file unit + a directory unit covering its files', () => {
    const m = fullM([payload('resources/blob.bin', 'file'), payload('resources/kb', 'directory')])
    const s = shape(
      ['resources/blob.bin', 'resources/kb/a.txt', 'resources/kb/sub/b.txt'],
      ['resources', 'resources/kb', 'resources/kb/sub']
    )
    const units = classifyPayloadLayout(s, m)
    expect(units.map((u) => u.payload.archivePath).sort()).toEqual(['resources/blob.bin', 'resources/kb'])
  })

  it('rejects a payload not under resources/', () => {
    const m = fullM([payload('backup.sqlite', 'file')])
    expect(reason(() => classifyPayloadLayout(shape([]), m))).toBe('layout')
  })

  it('rejects duplicate payload archivePaths', () => {
    const m = fullM([payload('resources/x', 'file'), payload('resources/X', 'file')])
    expect(reason(() => classifyPayloadLayout(shape(['resources/x']), m))).toBe('layout')
  })

  it('rejects overlapping payloads (a directory unit containing another)', () => {
    const m = fullM([payload('resources/kb', 'directory'), payload('resources/kb/inner', 'directory')])
    expect(reason(() => classifyPayloadLayout(shape([], ['resources/kb', 'resources/kb/inner']), m))).toBe('layout')
  })

  it('rejects an undeclared resource file', () => {
    const m = fullM([payload('resources/blob.bin', 'file')])
    expect(reason(() => classifyPayloadLayout(shape(['resources/blob.bin', 'resources/stray.bin']), m))).toBe('layout')
  })

  it('rejects an undeclared resource directory', () => {
    const m = fullM([payload('resources/blob.bin', 'file')])
    expect(reason(() => classifyPayloadLayout(shape(['resources/blob.bin'], ['resources/orphan']), m))).toBe('layout')
  })
})
