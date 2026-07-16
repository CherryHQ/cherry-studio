// Unit tests for manifest serialization — pure round-trip (no DB).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BACKUP_FORMAT_VERSION, type BackupManifest, readManifest, writeManifest } from '../manifest'

const SAMPLE: BackupManifest = {
  backupFormatVersion: BACKUP_FORMAT_VERSION,
  createdAt: '2026-07-04T12:00:00.000Z',
  preset: 'lite',
  domains: ['PREFERENCES', 'PROVIDERS'],
  includeFiles: false,
  includeKnowledgeFiles: false,
  sensitiveData: { included: true, rotated: false },
  schemaMigrationId: '0001_abc.sql',
  producerAppVersion: '1.0.0',
  files: { ids: [], total: 0, totalBytes: 0 },
  knowledge: { bases: [] },
  skills: { folders: [] },
  notes: { paths: [] },
  degraded: { resources: [] }
}

describe('manifest round-trip', () => {
  it('writeManifest → readManifest preserves all fields', async () => {
    // Arrange — temp dir so the test is isolated
    const dir = await mkdtemp(join(tmpdir(), 'cs-manifest-'))
    try {
      const p = join(dir, 'manifest.json')

      // Act
      await writeManifest(p, SAMPLE)
      const back = await readManifest(p)

      // Assert — every field survives serialization
      expect(back).toEqual(SAMPLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('BACKUP_FORMAT_VERSION is 1 (v2 baseline major)', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1)
  })

  it('readManifest returns a deep-frozen object (mutation throws in strict mode)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-manifest-'))
    try {
      const p = join(dir, 'manifest.json')
      await writeManifest(p, SAMPLE)
      const back = await readManifest(p)

      // Assert — top-level + nested array + nested object are frozen.
      // Casts target a MUTABLE shape so TS permits the assignment; the runtime
      // object is deep-frozen so each mutation throws TypeError (strict mode).
      expect(() => {
        ;(back as unknown as { preset: 'full' | 'lite' }).preset = 'full'
      }).toThrow(TypeError)
      expect(() => {
        ;(back.domains as unknown as string[]).push('TOPICS')
      }).toThrow(TypeError)
      expect(() => {
        ;(back.sensitiveData as unknown as { included: boolean }).included = false
      }).toThrow(TypeError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writeManifest emits valid JSON parseable by JSON.parse', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-manifest-'))
    try {
      const p = join(dir, 'manifest.json')
      await writeManifest(p, SAMPLE)
      // Act — parse the file directly (independent of readManifest)
      const raw = await readFile(p, 'utf8')
      expect(JSON.parse(raw)).toEqual(SAMPLE)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('readManifest rejects an unknown domain outside BACKUP_DOMAINS', async () => {
    // Arrange — craft a manifest whose domains include a value outside the 14
    // known domains. z.enum(BACKUP_DOMAINS) must reject it at the archive boundary
    // so a corrupted/tampered archive fails loud at parse, not deep in restore.
    const dir = await mkdtemp(join(tmpdir(), 'cs-manifest-'))
    try {
      const p = join(dir, 'manifest.json')
      const bad = { ...SAMPLE, domains: ['PREFERENCES', 'NOT_A_DOMAIN'] as readonly string[] }
      await writeFile(p, `${JSON.stringify(bad, null, 2)}\n`, 'utf8')

      // Act + Assert — parse rejects the unknown domain.
      await expect(readManifest(p)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
