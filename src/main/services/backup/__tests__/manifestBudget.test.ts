import { describe, expect, it } from 'vitest'

import { BACKUP_CEILINGS } from '../ceilings'
import { type BackupManifest, parseBackupManifest } from '../manifest'

/**
 * `maxManifestBytes` and `maxResourceInstallEntries` are not independent
 * ceilings: `manifest.json` carries the requirement and payload inventories, so
 * its size scales with the profile and the pre-parse byte cap is the only bound
 * on those arrays.
 *
 * A cap below what the install ceiling implies would make an archive at that
 * ceiling both unproducible (the producer rejects an over-cap manifest) and
 * unadmissible — two frozen constants silently contradicting each other. This
 * test is the proof that they still agree; it fails if either one is changed
 * without the other.
 */
describe('manifest byte budget vs the resource-install ceiling', () => {
  const ENTRIES = BACKUP_CEILINGS.maxResourceInstallEntries

  /** A representative path: `{prefix}/{uuid}`, the shape every adapter produces. */
  function uuidAt(index: number): string {
    return `${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
  }

  function manifestAtCeiling(): BackupManifest {
    return {
      backupFormatVersion: 2,
      createdAt: '2026-07-27T00:00:00.000Z',
      preset: 'full',
      producer: {
        appVersion: '2.0.0',
        platform: 'darwin',
        managedRoots: [
          { key: 'feature.notes.data', path: '/Users/someone/Library/Application Support/CherryStudio/Data/Notes' },
          {
            key: 'feature.agents.workspaces',
            path: '/Users/someone/Library/Application Support/CherryStudio/Data/Agents'
          }
        ]
      },
      migrationChain: [{ folderMillis: 1_700_000_000_000, hash: 'a'.repeat(64) }],
      db: { hash: 'b'.repeat(64), sizeBytes: 1_073_741_824 },
      resourceRequirements: Array.from({ length: ENTRIES }, (_, i) => ({
        kind: 'file-blob',
        resourceType: 'file' as const,
        livePath: `Data/Files/${uuidAt(i)}.pdf`
      })),
      resourcePayloads: Array.from({ length: ENTRIES }, (_, i) => ({
        kind: 'knowledge-base',
        resourceType: 'directory' as const,
        archivePath: `resources/knowledge-base/${uuidAt(i)}`,
        livePath: `Data/KnowledgeBase/${uuidAt(i)}`,
        hash: 'c'.repeat(64),
        sizeBytes: 123_456_789
      })),
      degradations: []
    }
  }

  it('serializes a manifest at the install ceiling within the pre-parse byte cap', () => {
    const manifest = manifestAtCeiling()
    expect(parseBackupManifest(manifest).kind).toBe('ok')

    // The producer serializes with 2-space indent (`archivePublish`), which is
    // the larger of the two forms, so measuring it bounds the compact form too.
    const bytes = Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf8')

    expect(bytes).toBeLessThanOrEqual(BACKUP_CEILINGS.maxManifestBytes)
  })
})
