// Unit tests for planResources — pure planning (no ImportOrchestrator / promotion).
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { application } from '@application'
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackupArchiveCorruptError } from '../errors'
import type { BackupManifest } from '../manifest'
import { assertFullManifestInvariants, type PlanCtx, planResources, type PlanRoots } from '../resourcePlanning'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

let userData: string
let filesRoot: string
let knowledgeRoot: string
let skillsRoot: string
let notesRoot: string
let workDir: string
let backupDbPath: string
let workDbPath: string

function makeMinimalDbs(): void {
  for (const p of [backupDbPath, workDbPath]) {
    const db = new Database(p)
    db.exec(`
      CREATE TABLE file_entry (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        ext TEXT,
        external_path TEXT
      );
      CREATE TABLE knowledge_base (id TEXT PRIMARY KEY);
      CREATE TABLE agent_global_skill (
        id TEXT PRIMARY KEY,
        folder_name TEXT NOT NULL UNIQUE
      );
    `)
    db.close()
  }
}

function seedBackupFile(id: string, origin: 'internal' | 'external', ext: string | null = 'txt'): void {
  const db = new Database(backupDbPath)
  db.prepare('INSERT INTO file_entry (id, origin, ext, external_path) VALUES (?, ?, ?, ?)').run(
    id,
    origin,
    ext,
    origin === 'external' ? '/tmp/ext' : null
  )
  db.close()
}

function seedWorkFile(id: string): void {
  const db = new Database(workDbPath)
  db.prepare("INSERT INTO file_entry (id, origin, ext, external_path) VALUES (?, 'internal', 'txt', NULL)").run(id)
  db.close()
}

function seedBackupKb(id: string): void {
  const db = new Database(backupDbPath)
  db.prepare('INSERT INTO knowledge_base (id) VALUES (?)').run(id)
  db.close()
}

function seedWorkKb(id: string): void {
  const db = new Database(workDbPath)
  db.prepare('INSERT INTO knowledge_base (id) VALUES (?)').run(id)
  db.close()
}

function seedBackupSkill(folderName: string): void {
  const db = new Database(backupDbPath)
  db.prepare('INSERT INTO agent_global_skill (id, folder_name) VALUES (?, ?)').run(`skill-${folderName}`, folderName)
  db.close()
}

function seedWorkSkill(folderName: string): void {
  const db = new Database(workDbPath)
  db.prepare('INSERT INTO agent_global_skill (id, folder_name) VALUES (?, ?)').run(`local-${folderName}`, folderName)
  db.close()
}

function writeStagingFile(rel: string, body = 'x'): void {
  const abs = join(workDir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

function writeStagingDir(rel: string): void {
  mkdirSync(join(workDir, rel), { recursive: true })
  writeFileSync(join(workDir, rel, 'marker'), '1')
}

function baseManifest(over: Partial<BackupManifest> = {}): BackupManifest {
  return {
    backupFormatVersion: 1,
    createdAt: new Date().toISOString(),
    preset: 'full',
    domains: [...BACKUP_DOMAINS],
    includeFiles: false,
    includeKnowledgeFiles: false,
    sensitiveData: { included: true, rotated: false },
    schemaMigrationId: '1',
    producerAppVersion: '1.0.0',
    files: { ids: [], total: 0, totalBytes: 0 },
    knowledge: { bases: [] },
    skills: { folders: [] },
    notes: { paths: [] },
    degraded: { resources: [] },
    ...over
  }
}

function roots(notes?: string): PlanRoots {
  return {
    files: filesRoot,
    knowledge: knowledgeRoot,
    skills: skillsRoot,
    notes: () => notes
  }
}

function ctx(manifest: BackupManifest, notes?: string): PlanCtx {
  return {
    manifest,
    workDir,
    backupDbPath,
    workPath: workDbPath,
    userData,
    roots: roots(notes)
  }
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'cs-plan-ud-'))
  filesRoot = join(userData, 'Data', 'Files')
  knowledgeRoot = join(userData, 'Data', 'KnowledgeBase')
  skillsRoot = join(userData, 'Data', 'Skills')
  notesRoot = join(userData, 'Notes')
  workDir = join(userData, 'restore-staging', 'rst-1')
  backupDbPath = join(workDir, 'backup.sqlite')
  workDbPath = join(workDir, 'work.sqlite')
  mkdirSync(filesRoot, { recursive: true })
  mkdirSync(knowledgeRoot, { recursive: true })
  mkdirSync(skillsRoot, { recursive: true })
  mkdirSync(notesRoot, { recursive: true })
  mkdirSync(workDir, { recursive: true })
  makeMinimalDbs()

  vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
    if (key === 'feature.files.data') {
      return filename ? join(filesRoot, filename) : filesRoot
    }
    return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(userData, { recursive: true, force: true })
})

describe('assertFullManifestInvariants', () => {
  it('allows full + includeFiles:false when files.ids is empty', () => {
    expect(() => assertFullManifestInvariants(baseManifest())).not.toThrow()
  })

  it('rejects domains that do not match resolvePreset(full)', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          domains: BACKUP_DOMAINS.filter((d) => d !== 'KNOWLEDGE')
        })
      )
    ).toThrow(BackupArchiveCorruptError)
  })

  it('rejects includeFiles inconsistent with files.ids', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          includeFiles: true,
          files: { ids: [], total: 0, totalBytes: 0 }
        })
      )
    ).toThrow(/includeFiles/)
  })

  it('rejects files.ids entries that are not file entry UUIDs', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          includeFiles: true,
          files: { ids: ['../evil'], total: 1, totalBytes: 1 }
        })
      )
    ).toThrow(/not a file entry UUID/)
  })

  it('rejects unsafe knowledge baseId', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          includeKnowledgeFiles: true,
          knowledge: { bases: ['../escape'] }
        })
      )
    ).toThrow(BackupArchiveCorruptError)
  })

  it('rejects notes relPath with ..', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          notes: { paths: ['../outside.md'] }
        })
      )
    ).toThrow(/\.\./)
  })

  it('no-ops for lite preset', () => {
    expect(() =>
      assertFullManifestInvariants(
        baseManifest({
          preset: 'lite',
          domains: ['PREFERENCES']
        })
      )
    ).not.toThrow()
  })
})

describe('planResources', () => {
  it('returns empty plan for lite preset', () => {
    const plan = planResources(
      ctx(
        baseManifest({
          preset: 'lite',
          domains: BACKUP_DOMAINS.filter(
            (d) => d !== 'KNOWLEDGE' && d !== 'PAINTINGS' && d !== 'FILE_STORAGE' && d !== 'TRANSLATE_HISTORY'
          )
        })
      )
    )
    expect(plan.resources).toEqual([])
    expect(plan.stagedFileEntryIds.size).toBe(0)
    expect(plan.toRestore).toEqual([])
  })

  it('stages a new file as blob-add', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', 'txt')
    writeStagingFile('files/0f100000-0000-4000-8000-000000000001')
    const plan = planResources(
      ctx(
        baseManifest({
          includeFiles: true,
          files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
        })
      )
    )
    expect(plan.stagedFileEntryIds).toEqual(new Set(['0f100000-0000-4000-8000-000000000001']))
    expect(plan.resources).toEqual([
      {
        kind: 'blob-add',
        stagingPath: 'restore-staging/rst-1/files/0f100000-0000-4000-8000-000000000001',
        livePath: 'Data/Files/0f100000-0000-4000-8000-000000000001.txt'
      }
    ])
    expect(plan.toRestore).toEqual([{ kind: 'file', count: 1 }])
  })

  it('skips file when live blob exists (skippedFileEntryIds)', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', 'txt')
    writeStagingFile('files/0f100000-0000-4000-8000-000000000001')
    writeFileSync(join(filesRoot, '0f100000-0000-4000-8000-000000000001.txt'), 'local')
    const plan = planResources(
      ctx(
        baseManifest({
          includeFiles: true,
          files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
        })
      )
    )
    expect(plan.skippedFileEntryIds).toEqual(new Set(['0f100000-0000-4000-8000-000000000001']))
    expect(plan.resources).toEqual([])
    expect(plan.skips[0]).toMatchObject({
      id: '0f100000-0000-4000-8000-000000000001',
      kind: 'file',
      reason: 'live exists'
    })
  })

  it('skips file when local DB row exists (workDb homology)', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', 'txt')
    seedWorkFile('0f100000-0000-4000-8000-000000000001')
    writeStagingFile('files/0f100000-0000-4000-8000-000000000001')
    const plan = planResources(
      ctx(
        baseManifest({
          includeFiles: true,
          files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
        })
      )
    )
    expect(plan.skippedFileEntryIds).toEqual(new Set(['0f100000-0000-4000-8000-000000000001']))
    expect(plan.skips[0]?.reason).toBe('local DB row exists')
  })

  it('CORRUPT when file is external', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'external', 'txt')
    writeStagingFile('files/0f100000-0000-4000-8000-000000000001')
    expect(() =>
      planResources(
        ctx(
          baseManifest({
            includeFiles: true,
            files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
          })
        )
      )
    ).toThrow(/missing or external/)
  })

  it('CORRUPT when the backup row ext is unsafe (path fragment)', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', '../txt')
    writeStagingFile('files/0f100000-0000-4000-8000-000000000001')
    expect(() =>
      planResources(
        ctx(
          baseManifest({
            includeFiles: true,
            files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
          })
        )
      )
    ).toThrow(/unsafe ext/)
  })

  it('CORRUPT when staging file missing', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', 'txt')
    expect(() =>
      planResources(
        ctx(
          baseManifest({
            includeFiles: true,
            files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
          })
        )
      )
    ).toThrow(/staging file missing/)
  })

  it('CORRUPT when staging file is symlink', () => {
    seedBackupFile('0f100000-0000-4000-8000-000000000001', 'internal', 'txt')
    mkdirSync(join(workDir, 'files'), { recursive: true })
    const target = join(workDir, 'files', 'real')
    writeFileSync(target, 'x')
    symlinkSync(target, join(workDir, 'files', '0f100000-0000-4000-8000-000000000001'))
    expect(() =>
      planResources(
        ctx(
          baseManifest({
            includeFiles: true,
            files: { ids: ['0f100000-0000-4000-8000-000000000001'], total: 1, totalBytes: 1 }
          })
        )
      )
    ).toThrow(/symlink/)
  })

  it('stages knowledge dir-add and skips on conflict into skippedKnowledgeBaseIds', () => {
    seedBackupKb('kb1')
    seedBackupKb('kb2')
    writeStagingDir('knowledge/kb1')
    writeStagingDir('knowledge/kb2')
    seedWorkKb('kb2')
    const plan = planResources(
      ctx(
        baseManifest({
          includeKnowledgeFiles: true,
          knowledge: { bases: ['kb1', 'kb2'] }
        })
      )
    )
    expect(plan.resources).toEqual([
      {
        kind: 'dir-add',
        stagingPath: 'restore-staging/rst-1/knowledge/kb1',
        livePath: 'Data/KnowledgeBase/kb1'
      }
    ])
    expect(plan.skippedKnowledgeBaseIds).toEqual(new Set(['kb2']))
    expect(plan.toRestore).toEqual([{ kind: 'knowledge', count: 1 }])
  })

  it('CORRUPT when knowledge base missing from backup DB', () => {
    writeStagingDir('knowledge/kb-missing')
    expect(() =>
      planResources(
        ctx(
          baseManifest({
            includeKnowledgeFiles: true,
            knowledge: { bases: ['kb-missing'] }
          })
        )
      )
    ).toThrow(/missing from backup DB/)
  })

  it('stages skill dir-add and skips on conflict into skippedSkillFolderNames (folderName)', () => {
    seedBackupSkill('zipSkill')
    seedBackupSkill('localSkill')
    writeStagingDir('skills/zipSkill')
    writeStagingDir('skills/localSkill')
    seedWorkSkill('localSkill')
    const plan = planResources(
      ctx(
        baseManifest({
          skills: {
            folders: [
              { folderName: 'zipSkill', contentHash: 'a' },
              { folderName: 'localSkill', contentHash: 'b' }
            ]
          }
        })
      )
    )
    expect(plan.resources).toEqual([
      {
        kind: 'dir-add',
        stagingPath: 'restore-staging/rst-1/skills/zipSkill',
        livePath: 'Data/Skills/zipSkill'
      }
    ])
    expect(plan.skippedSkillFolderNames).toEqual(new Set(['localSkill']))
    expect(plan.skips.find((s) => s.kind === 'skill')?.id).toBe('localSkill')
  })

  it('toRestore keeps knowledge vs skill counts separate', () => {
    seedBackupKb('kb1')
    seedBackupSkill('s1')
    writeStagingDir('knowledge/kb1')
    writeStagingDir('skills/s1')
    const plan = planResources(
      ctx(
        baseManifest({
          includeKnowledgeFiles: true,
          knowledge: { bases: ['kb1'] },
          skills: { folders: [{ folderName: 's1', contentHash: 'h' }] }
        })
      )
    )
    expect(plan.toRestore).toEqual([
      { kind: 'knowledge', count: 1 },
      { kind: 'skill', count: 1 }
    ])
  })

  it('stages managed note-add and skips conflicts', () => {
    writeStagingFile('notes/a.md', '# a')
    writeStagingFile('notes/b.md', '# b')
    writeFileSync(join(notesRoot, 'b.md'), 'local')
    const plan = planResources(
      ctx(
        baseManifest({
          notes: { paths: ['a.md', 'b.md'] }
        }),
        notesRoot
      )
    )
    expect(plan.resources).toEqual([
      {
        kind: 'note-add',
        stagingPath: 'restore-staging/rst-1/notes/a.md',
        livePath: 'Notes/a.md'
      }
    ])
    expect(plan.skips).toEqual([{ id: 'b.md', kind: 'note', reason: 'exists — skip' }])
    expect(plan.toRestore).toEqual([{ kind: 'note', count: 1 }])
  })

  it('skips notes when notesRoot is missing (records skips)', () => {
    writeStagingFile('notes/a.md', '# a')
    const plan = planResources(
      ctx(
        baseManifest({
          notes: { paths: ['a.md'] }
        }),
        undefined
      )
    )
    expect(plan.resources).toEqual([])
    expect(plan.skips).toEqual([{ id: 'a.md', kind: 'note', reason: 'no managed notesRoot' }])
  })

  it('skips notes outside userData', () => {
    const outsideNotes = mkdtempSync(join(tmpdir(), 'cs-plan-notes-out-'))
    try {
      writeStagingFile('notes/a.md', '# a')
      const plan = planResources(
        ctx(
          baseManifest({
            notes: { paths: ['a.md'] }
          }),
          outsideNotes
        )
      )
      expect(plan.resources).toEqual([])
      expect(plan.skips[0]).toMatchObject({ id: 'a.md', kind: 'note', reason: 'outside userData' })
    } finally {
      rmSync(outsideNotes, { recursive: true, force: true })
    }
  })
})
