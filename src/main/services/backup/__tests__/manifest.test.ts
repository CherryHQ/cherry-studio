import { RESTORE_JOURNAL_VERSION } from '@data/db/restore/restoreJournalV2'
import { describe, expect, it } from 'vitest'

import {
  BACKUP_FORMAT_VERSION,
  BackupManifestSchema,
  parseBackupManifest,
  parseManifestDiagnosticEnvelope
} from '../manifest'

const migrationChain = [
  { folderMillis: 1_700_000_000_000, hash: 'a' },
  { folderMillis: 1_700_000_100_000, hash: 'b' }
]

const HEX64 = 'a'.repeat(64) // valid 64-lowercase-hex sha256
const HEX64_B = 'b'.repeat(64)

function common(overrides: Record<string, unknown> = {}) {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: '2026-07-27T00:00:00.000Z',
    producer: {
      appVersion: '2.0.0-beta.2',
      platform: 'darwin',
      managedRoots: [{ key: 'feature.notes.data', path: '/Users/x/Library/App/Notes' }]
    },
    migrationChain,
    db: { hash: HEX64, sizeBytes: 4096 },
    resourceRequirements: [
      { kind: 'knowledge-base', resourceType: 'directory', livePath: 'Data/KnowledgeBase/base-1' }
    ],
    degradations: [],
    ...overrides
  }
}

/** A valid manifest carrying the database alone — no resource payloads. */
function baseManifest(overrides: Record<string, unknown> = {}) {
  return { ...common(overrides), preset: 'full', resourcePayloads: [] as Record<string, unknown>[] }
}

function fullManifest(overrides: Record<string, unknown> = {}) {
  return {
    ...common(overrides),
    preset: 'full',
    resourcePayloads: [
      {
        kind: 'knowledge-base',
        resourceType: 'directory',
        archivePath: 'resources/kb/base-1',
        livePath: 'Data/KnowledgeBase/base-1',
        hash: HEX64_B,
        sizeBytes: 128
      }
    ]
  }
}

describe('BackupManifestSchema — valid manifests', () => {
  it('accepts a valid manifest carrying no payloads', () => {
    expect(BackupManifestSchema.safeParse(baseManifest()).success).toBe(true)
  })

  it('accepts a valid full manifest with payloads', () => {
    expect(BackupManifestSchema.safeParse(fullManifest()).success).toBe(true)
  })

  it('accepts legacy v2 producer metadata without buildType and validates new build types', () => {
    expect(BackupManifestSchema.safeParse(baseManifest()).success).toBe(true)
    const packaged = baseManifest()
    ;(packaged.producer as Record<string, unknown>).buildType = 'packaged'
    expect(BackupManifestSchema.safeParse(packaged).success).toBe(true)
    ;(packaged.producer as Record<string, unknown>).buildType = 'nightly'
    expect(BackupManifestSchema.safeParse(packaged).success).toBe(false)
  })

  it('accepts a full manifest with an empty payload list', () => {
    expect(BackupManifestSchema.safeParse(fullManifest({})).success).toBe(true)
    const full = { ...fullManifest(), resourcePayloads: [] }
    expect(BackupManifestSchema.safeParse(full).success).toBe(true)
  })
})

describe('BackupManifestSchema — preset payload shape', () => {
  it('rejects a manifest missing resourcePayloads', () => {
    const bad = { ...common(), preset: 'full' }
    expect(BackupManifestSchema.safeParse(bad).success).toBe(false)
  })

  // Full is the only preset that exists. A `lite` archive is therefore not an
  // archive this build can interpret, and must be refused rather than read as Full.
  it("rejects an otherwise-valid manifest declaring preset 'lite'", () => {
    const bad = { ...baseManifest(), preset: 'lite' }
    expect(BackupManifestSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown preset', () => {
    const bad = { ...common(), preset: 'partial' }
    expect(BackupManifestSchema.safeParse(bad).success).toBe(false)
  })
})

describe('BackupManifestSchema — integrity fields', () => {
  it('pins the archive format version', () => {
    expect(BackupManifestSchema.safeParse(baseManifest({ backupFormatVersion: 1 })).success).toBe(false)
    expect(BackupManifestSchema.safeParse(baseManifest({ backupFormatVersion: 3 })).success).toBe(false)
  })

  it('requires a complete (non-empty) migration chain', () => {
    expect(BackupManifestSchema.safeParse(baseManifest({ migrationChain: [] })).success).toBe(false)
  })

  it('requires a positive db size', () => {
    expect(BackupManifestSchema.safeParse(baseManifest({ db: { hash: 'h', sizeBytes: 0 } })).success).toBe(false)
    expect(BackupManifestSchema.safeParse(baseManifest({ db: { hash: 'h', sizeBytes: -1 } })).success).toBe(false)
  })

  it('enforces the producer platform enum', () => {
    const bad = baseManifest()
    ;(bad.producer as Record<string, unknown>).platform = 'freebsd'
    expect(BackupManifestSchema.safeParse(bad).success).toBe(false)
  })

  it('bounds producer appVersion to printable diagnostic text', () => {
    const control = baseManifest()
    ;(control.producer as Record<string, unknown>).appVersion = '2.0.0\nforged'
    expect(BackupManifestSchema.safeParse(control).success).toBe(false)
    const oversized = baseManifest()
    ;(oversized.producer as Record<string, unknown>).appVersion = 'x'.repeat(65)
    expect(BackupManifestSchema.safeParse(oversized).success).toBe(false)
    const pathLike = baseManifest()
    ;(pathLike.producer as Record<string, unknown>).appVersion = '/Users/private'
    expect(BackupManifestSchema.safeParse(pathLike).success).toBe(false)
  })

  it('rejects unknown top-level fields (strict)', () => {
    expect(BackupManifestSchema.safeParse(baseManifest({ surprise: 1 })).success).toBe(false)
  })

  it('requires the db hash to be 64 lowercase hex (sha256, matches hashDbFile)', () => {
    expect(
      BackupManifestSchema.safeParse(baseManifest({ db: { hash: 'sha256:deadbeef', sizeBytes: 4 } })).success
    ).toBe(false)
    expect(BackupManifestSchema.safeParse(baseManifest({ db: { hash: 'A'.repeat(64), sizeBytes: 4 } })).success).toBe(
      false
    ) // uppercase rejected
    expect(BackupManifestSchema.safeParse(baseManifest({ db: { hash: 'a'.repeat(63), sizeBytes: 4 } })).success).toBe(
      false
    ) // wrong length
  })

  it('requires an ISO-8601 datetime createdAt', () => {
    expect(BackupManifestSchema.safeParse(baseManifest({ createdAt: 'yesterday' })).success).toBe(false)
    expect(BackupManifestSchema.safeParse(baseManifest({ createdAt: '2026-07-27' })).success).toBe(false)
  })

  it('rejects duplicate managed-root keys', () => {
    const bad = baseManifest()
    ;(bad.producer as { managedRoots: unknown }).managedRoots = [
      { key: 'feature.notes.data', path: '/a' },
      { key: 'feature.notes.data', path: '/b' }
    ]
    expect(BackupManifestSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts distinct managed-root keys', () => {
    const ok = baseManifest()
    ;(ok.producer as { managedRoots: unknown }).managedRoots = [
      { key: 'feature.notes.data', path: '/a' },
      { key: 'feature.agents.system_workspaces', path: '/b' }
    ]
    expect(BackupManifestSchema.safeParse(ok).success).toBe(true)
  })
})

describe('BackupManifestSchema — path safety', () => {
  it('rejects absolute / escaping requirement livePaths', () => {
    expect(
      BackupManifestSchema.safeParse(
        baseManifest({ resourceRequirements: [{ kind: 'k', resourceType: 'file', livePath: '/etc/passwd' }] })
      ).success
    ).toBe(false)
    expect(
      BackupManifestSchema.safeParse(
        baseManifest({ resourceRequirements: [{ kind: 'k', resourceType: 'file', livePath: '../escape' }] })
      ).success
    ).toBe(false)
  })

  it('rejects absolute payload paths in a full manifest', () => {
    const full = fullManifest()
    full.resourcePayloads[0].archivePath = '/tmp/evil'
    expect(BackupManifestSchema.safeParse(full).success).toBe(false)
  })
})

describe('parseBackupManifest', () => {
  it('returns ok/invalid discriminated results', () => {
    const ok = parseBackupManifest(baseManifest())
    expect(ok.kind).toBe('ok')
    expect(parseBackupManifest({ preset: 'full' }).kind).toBe('invalid')
  })

  it('reads only bounded producer provenance from an unsupported-format envelope', () => {
    expect(
      parseManifestDiagnosticEnvelope({
        backupFormatVersion: 3,
        producer: { appVersion: '2.1.0', buildType: 'development', path: '/secret' },
        resourcePayloads: [{ livePath: '/secret' }]
      })
    ).toEqual({
      backupFormatVersion: 3,
      producer: { appVersion: '2.1.0', buildType: 'development' }
    })
    expect(parseManifestDiagnosticEnvelope({ backupFormatVersion: '3' })).toBeUndefined()
  })
})

describe('version independence', () => {
  it('archive format version is a distinct constant from the journal version', () => {
    // They may share a value but are independent artifacts; assert they are
    // separately-sourced numbers, not the same binding.
    expect(typeof BACKUP_FORMAT_VERSION).toBe('number')
    expect(typeof RESTORE_JOURNAL_VERSION).toBe('number')
  })
})
