/**
 * e2e-export lite roundtrip (批次1) — AC: `__tests__/e2e/export.lite.test.ts`
 * Soft deps: packaged-export-gate (online backup path); notes/KB excluded by preset.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { snapshotTo } from '@data/db/restore/snapshot'
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import { appStateTable } from '@main/data/db/schemas/appState'
import { assistantTable } from '@main/data/db/schemas/assistant'
import { assistantKnowledgeBaseTable } from '@main/data/db/schemas/assistantRelations'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'
import { knowledgeBaseTable } from '@main/data/db/schemas/knowledge'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { describe, expect, it } from 'vitest'

import { contributorManager } from '../../contributors/ContributorManager'
import { SqliteBackupStripper } from '../../ExcludedDomainStripper'
import { ExportOrchestrator } from '../../ExportOrchestrator'

const ASSISTANT_SETTINGS = {
  temperature: 1.0,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  streamOutput: true,
  reasoning_effort: 'default',
  mcpMode: 'auto' as const,
  maxToolCalls: 20,
  enableMaxToolCalls: true,
  enableWebSearch: false,
  enableGenerateImage: false,
  customParameters: []
}

describe('e2e-export lite roundtrip', () => {
  const dbh = setupTestDatabase()

  it('exports lite archive: manifest + backup.sqlite, no files/knowledge/notes blobs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-e2e-export-lite-'))
    try {
      await dbh.db.insert(topicTable).values([{ id: 'tpc1', name: 'T', isNameManuallyEdited: false, orderKey: 'a' }])
      await dbh.db.insert(messageTable).values([
        {
          id: 'msg1',
          topicId: 'tpc1',
          role: 'root',
          parentId: null,
          data: { parts: [] },
          searchableText: '',
          status: 'success',
          siblingsGroupId: 0
        }
      ])
      await dbh.db.insert(assistantTable).values([
        {
          id: 'ast1',
          name: 'A',
          prompt: '',
          emoji: '🤖',
          description: '',
          settings: ASSISTANT_SETTINGS,
          orderKey: 'a'
        }
      ])
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'test', ext: 'txt', size: 5 }])
      await dbh.db
        .insert(chatMessageFileRefTable)
        .values([{ id: 'cmfr1', fileEntryId: 'f1', sourceId: 'msg1', role: 'attachment' }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'KB', status: 'completed', chunkSize: 500, chunkOverlap: 50 }])
      await dbh.db.insert(assistantKnowledgeBaseTable).values([{ assistantId: 'ast1', knowledgeBaseId: 'kb1' }])
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])

      await mkdir(join(dir, 'notes-root'), { recursive: true })
      await writeFile(join(dir, 'notes-root', 'secret.md'), '# must NOT appear in lite')

      const orch = new ExportOrchestrator({
        dbService: {
          createSnapshot: (destPath) => {
            snapshotTo(dbh.sqlite, destPath)
          }
        },
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        knowledgeRoot: join(dir, 'kb-root'),
        skillsRoot: join(dir, 'skills-root'),
        notesRoot: () => {
          throw new Error('notesRoot must not be called on lite export')
        },
        stripper: new SqliteBackupStripper()
      })

      const out = join(dir, 'lite.cbu')
      const { manifest } = await orch.exportBackup({
        preset: 'lite',
        outputPath: out,
        restoreId: 'e2e-lite',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      expect(manifest.preset).toBe('lite')
      expect(manifest.domains).toHaveLength(10)
      expect(new Set(manifest.domains)).toEqual(
        new Set(
          BACKUP_DOMAINS.filter((d) => !['KNOWLEDGE', 'PAINTINGS', 'FILE_STORAGE', 'TRANSLATE_HISTORY'].includes(d))
        )
      )
      expect(manifest.includeFiles).toBe(false)
      expect(manifest.includeKnowledgeFiles).toBe(false)
      expect(manifest.notes.paths).toEqual([])

      const zip = new StreamZip.async({ file: out })
      try {
        const entries = Object.keys(await zip.entries())
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('notes/'))).toBe(false)

        const extracted = join(dir, 'lite.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          expect(count('topic')).toBe(1)
          expect(count('app_state')).toBe(0)
          expect(count('file_entry')).toBe(0)
          expect(count('knowledge_base')).toBe(0)
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
