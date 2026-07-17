/**
 * e2e-export full roundtrip (批次1) — AC: `__tests__/e2e/export.full.test.ts`
 * Soft asserts: no `.cherry/index.sqlite*` (knowledge-r1) + notes body 1:1 (fs-catch).
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentGlobalSkillTable } from '@main/data/db/schemas/agentGlobalSkill'
import { appStateTable } from '@main/data/db/schemas/appState'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { knowledgeBaseTable } from '@main/data/db/schemas/knowledge'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { describe, expect, it } from 'vitest'

import { contributorManager } from '../../contributors/ContributorManager'
import { SqliteBackupStripper } from '../../ExcludedDomainStripper'
import { ExportOrchestrator } from '../../ExportOrchestrator'

function pathFileBlobs(lookup: Record<string, string>) {
  return {
    async copyContentTo(id: string, destPath: string): Promise<{ size: number }> {
      const src = lookup[id]
      if (!src) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      await copyFile(src, destPath)
      const s = await stat(destPath)
      return { size: s.size }
    },
    async getMetadata(id: string): Promise<{ size: number }> {
      const src = lookup[id]
      if (!src) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      const s = await stat(src)
      return { size: s.size }
    }
  }
}

describe('e2e-export full roundtrip', () => {
  const dbh = setupTestDatabase()

  it('exports full archive with files/KB/skills/notes; soft: no index.sqlite + notes 1:1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-e2e-export-full-'))
    try {
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'kb', status: 'completed', chunkSize: 100, chunkOverlap: 20 }])
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])
      await dbh.db.insert(agentGlobalSkillTable).values([
        { id: 's1', folderName: 'zipSkill', name: 'z', source: 'zip', contentHash: 'hz', isEnabled: true }
      ])

      const filesRoot = await mkdtemp(join(tmpdir(), 'cs-e2e-files-'))
      const kbRoot = await mkdtemp(join(tmpdir(), 'cs-e2e-kb-'))
      const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-e2e-skills-'))
      const notesRoot = await mkdtemp(join(tmpdir(), 'cs-e2e-notes-'))
      const note1Body = Buffer.from('# note 1')
      const note2Body = Buffer.from('# note 2')
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')
      await mkdir(join(kbRoot, 'kb1', '.cherry'), { recursive: true })
      await mkdir(join(kbRoot, 'kb1', 'raw'), { recursive: true })
      await writeFile(join(kbRoot, 'kb1', 'source.md'), 'doc')
      await writeFile(join(kbRoot, 'kb1', 'raw', 'kept.md'), 'raw-body')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite'), 'INDEX')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-wal'), 'WAL')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-shm'), 'SHM')
      await mkdir(join(skillsRoot, 'zipSkill'), { recursive: true })
      await writeFile(join(skillsRoot, 'zipSkill', 'SKILL.md'), 'skill-body')
      await writeFile(join(notesRoot, 'note1.md'), note1Body)
      await mkdir(join(notesRoot, 'sub'), { recursive: true })
      await writeFile(join(notesRoot, 'sub', 'note2.md'), note2Body)

      const orch = new ExportOrchestrator({
        dbService: {
          backupTo: async (destPath) => {
            const { unlink } = await import('node:fs/promises')
            await unlink(destPath).catch(() => {})
            await dbh.sqlite.backup(destPath)
          }
        },
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        fileBlobs: pathFileBlobs({ f1: join(filesRoot, 'f1.txt') }),
        knowledgeRoot: kbRoot,
        skillsRoot,
        notesRoot: () => notesRoot,
        stripper: new SqliteBackupStripper()
      })

      const out = join(dir, 'full.cbu')
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'e2e-full',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      expect(manifest.preset).toBe('full')
      expect(manifest.includeFiles).toBe(true)
      expect(manifest.files.ids).toEqual(['f1'])
      expect(manifest.knowledge.bases).toEqual(['kb1'])
      expect(manifest.skills.folders).toEqual([{ folderName: 'zipSkill', contentHash: 'hz' }])
      expect(new Set(manifest.notes.paths)).toEqual(new Set(['note1.md', 'sub/note2.md']))

      const zip = new StreamZip.async({ file: out })
      try {
        const entries = Object.keys(await zip.entries())
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries).toContain('files/f1')
        expect(entries).toContain('knowledge/kb1/source.md')
        expect(entries).toContain('knowledge/kb1/raw/kept.md')
        expect(entries.some((e) => e.startsWith('skills/'))).toBe(true)
        expect(entries).toContain('skills/zipSkill/SKILL.md')
        // soft: knowledge-r1 — no derived vector index in archive
        expect(entries.some((e) => e.includes('index.sqlite'))).toBe(false)
        // soft: fs-catch — notes body 1:1 with collected/staged paths (byte-exact)
        expect(entries).toContain('notes/note1.md')
        expect(entries).toContain('notes/sub/note2.md')
        for (const rel of manifest.notes.paths) {
          expect(entries).toContain(`notes/${rel}`)
        }
        expect(Buffer.from(await zip.entryData('notes/note1.md'))).toEqual(note1Body)
        expect(Buffer.from(await zip.entryData('notes/sub/note2.md'))).toEqual(note2Body)
        // also agree with on-disk sources (regression against silent truncate/transform)
        expect(Buffer.from(await zip.entryData('notes/note1.md'))).toEqual(await readFile(join(notesRoot, 'note1.md')))
        expect(Buffer.from(await zip.entryData('notes/sub/note2.md'))).toEqual(
          await readFile(join(notesRoot, 'sub', 'note2.md'))
        )

        const extracted = join(dir, 'full.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          expect(count('file_entry')).toBe(1)
          expect(count('knowledge_base')).toBe(1)
          expect(count('agent_global_skill')).toBe(1)
          expect(count('app_state')).toBe(0)
        } finally {
          d.close()
        }
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
