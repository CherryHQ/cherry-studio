import { describe, expect, it } from 'vitest'

import { parseBackupManifest } from '../manifest'

const valid = {
  backupFormatVersion: 2,
  preset: 'lite',
  createdAt: '2026-07-28T00:00:00.000Z',
  producer: { platform: 'linux', managedRoots: [] },
  migrationChain: [{ folderMillis: 1, hash: 'migration' }],
  db: { hash: 'a'.repeat(64), sizeBytes: 1 }
} as const

describe('BackupManifest', () => {
  it('accepts the closed Lite contract', () => {
    expect(parseBackupManifest(valid)).toMatchObject({ kind: 'ok' })
  })

  it.each([
    { ...valid, preset: 'full' },
    { ...valid, resourcePayloads: [] },
    { ...valid, producer: { ...valid.producer, appVersion: '2.0.0' } },
    { ...valid, backupFormatVersion: 3 }
  ])('rejects Full and unsupported compatibility surface', (manifest) => {
    expect(parseBackupManifest(manifest).kind).toBe('invalid')
  })
})
