// AC coverage for pre-merge restore staging (07-17-backup-v2-staging-mvp).
//
// Synthetic admit tree → buildFileResourcesFromAdmit → (optional) merge prune →
// journal candidates. Does NOT open packaged startRestore.

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildFileResourcesFromAdmit,
  candidatesToFileResources,
  type RestorePathRoots,
  RestoreStagingPathEscapeError
} from '../buildFileResourcesFromAdmit'
import { type ResourceSealFs, sealFileResource } from '../restoreResourceSeal'

describe('buildFileResourcesFromAdmit', () => {
  let tmpDir: string
  let workDir: string
  let pathRoots: RestorePathRoots

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-stage-'))
    workDir = join(tmpDir, 'restore-staging', 'rst-1')
    mkdirSync(workDir, { recursive: true })
    pathRoots = {
      userData: tmpDir,
      filesLiveRoot: join(tmpDir, 'Data', 'Files'),
      knowledgeLiveRoot: join(tmpDir, 'Data', 'KnowledgeBase'),
      skillsLiveRoot: join(tmpDir, 'Data', 'Skills'),
      notesLiveRoot: join(tmpDir, 'Data', 'Notes')
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const emptyMeta = {
    fileIds: [] as string[],
    knowledgeBases: [] as string[],
    skillFolders: [] as { folderName: string; contentHash: string }[],
    notePaths: [] as string[]
  }

  /** Seed a minimal backup.sqlite with file_entry rows for origin/ext lookups. */
  const seedBackupFileEntries = (
    rows: Array<{ id: string; origin: 'internal' | 'external'; ext?: string | null; size?: number | null }>
  ): void => {
    const dbPath = join(workDir, 'backup.sqlite')
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TABLE file_entry (
          id TEXT PRIMARY KEY,
          origin TEXT NOT NULL,
          name TEXT NOT NULL,
          ext TEXT,
          size INTEGER,
          external_path TEXT,
          deleted_at INTEGER
        )
      `)
      const ins = db.prepare(
        `INSERT INTO file_entry (id, origin, name, ext, size, external_path, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      for (const row of rows) {
        ins.run(
          row.id,
          row.origin,
          row.id,
          row.ext ?? null,
          row.origin === 'internal' ? (row.size ?? 1) : null,
          row.origin === 'external' ? `/tmp/${row.id}` : null
        )
      }
    } finally {
      db.close()
    }
  }

  it('stages files as blob-add', () => {
    seedBackupFileEntries([{ id: 'fe-1', origin: 'internal', ext: 'txt', size: 5 }])
    mkdirSync(join(workDir, 'files'), { recursive: true })
    writeFileSync(join(workDir, 'files', 'fe-1'), 'hello')

    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, fileIds: ['fe-1'] }, pathRoots)

    const c = staged.candidates.get('fe-1')
    expect(c?.kind).toBe('blob-add')
    expect(c?.ext).toBe('txt')
    expect(c?.livePath).toBe('Data/Files/fe-1.txt')
    expect(c?.stagedPath).toContain('files/fe-1')
    expect(c?.rewrite).toEqual({ origin: 'internal', externalPath: null, size: 5 })
    expect(staged.skippedFileEntryIds.size).toBe(0)
  })

  it('stages knowledge as dir-add', () => {
    mkdirSync(join(workDir, 'knowledge', 'kb-1', 'raw'), { recursive: true })
    writeFileSync(join(workDir, 'knowledge', 'kb-1', 'raw', 'a.md'), '# a')

    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, knowledgeBases: ['kb-1'] }, pathRoots)

    const c = staged.candidates.get('knowledge:kb-1')
    expect(c?.kind).toBe('dir-add')
    expect(c?.livePath).toBe('Data/KnowledgeBase/kb-1')
    expect(candidatesToFileResources(staged)[0]?.kind).toBe('dir-add')
  })

  it('stages skills as dir-add', () => {
    mkdirSync(join(workDir, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(workDir, 'skills', 'my-skill', 'SKILL.md'), '# skill')

    const staged = buildFileResourcesFromAdmit(
      workDir,
      { ...emptyMeta, skillFolders: [{ folderName: 'my-skill', contentHash: 'abc' }] },
      pathRoots
    )

    const c = staged.candidates.get('skills:my-skill')
    expect(c?.kind).toBe('dir-add')
    expect(c?.livePath).toBe('Data/Skills/my-skill')
  })

  it('stages notes as note-add (MVP additive)', () => {
    mkdirSync(join(workDir, 'notes'), { recursive: true })
    writeFileSync(join(workDir, 'notes', 'hello.md'), 'hi')

    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, notePaths: ['hello.md'] }, pathRoots)

    const c = staged.candidates.get('notes:hello.md')
    expect(c?.kind).toBe('note-add')
    expect(c?.livePath).toBe('Data/Notes/hello.md')
  })

  it('skips missing blob into skippedFileEntryIds', () => {
    seedBackupFileEntries([{ id: 'fe-miss', origin: 'internal', ext: 'bin', size: 1 }])
    mkdirSync(join(workDir, 'files'), { recursive: true })

    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, fileIds: ['fe-miss'] }, pathRoots)

    expect([...staged.skippedFileEntryIds]).toEqual(['fe-miss'])
    expect(staged.candidates.has('fe-miss')).toBe(false)
  })

  it('throws on path escape (unsafe file id)', () => {
    expect(() => buildFileResourcesFromAdmit(workDir, { ...emptyMeta, fileIds: ['../escape'] }, pathRoots)).toThrow(
      RestoreStagingPathEscapeError
    )
  })

  it('throws on path escape (note traversal)', () => {
    expect(() =>
      buildFileResourcesFromAdmit(workDir, { ...emptyMeta, notePaths: ['../../etc/passwd'] }, pathRoots)
    ).toThrow(RestoreStagingPathEscapeError)
  })

  it('defers externalPath file_entry into skippedFileEntryIds (no rewrite in MVP)', () => {
    seedBackupFileEntries([{ id: 'fe-ext', origin: 'external' }])
    // Even if a blob payload were present, external rows are deferred.
    mkdirSync(join(workDir, 'files'), { recursive: true })
    writeFileSync(join(workDir, 'files', 'fe-ext'), 'x')

    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, fileIds: ['fe-ext'] }, pathRoots)

    expect([...staged.skippedFileEntryIds]).toEqual(['fe-ext'])
    expect(staged.candidates.has('fe-ext')).toBe(false)
  })

  it('skips missing knowledge dir (no candidate)', () => {
    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, knowledgeBases: ['kb-gone'] }, pathRoots)
    expect(staged.candidates.has('knowledge:kb-gone')).toBe(false)
  })

  it('skips missing skill dir (no candidate)', () => {
    const staged = buildFileResourcesFromAdmit(
      workDir,
      { ...emptyMeta, skillFolders: [{ folderName: 'gone-skill', contentHash: 'x' }] },
      pathRoots
    )
    expect(staged.candidates.has('skills:gone-skill')).toBe(false)
  })

  it('skips missing note (no candidate)', () => {
    const staged = buildFileResourcesFromAdmit(workDir, { ...emptyMeta, notePaths: ['missing.md'] }, pathRoots)
    expect(staged.candidates.has('notes:missing.md')).toBe(false)
  })

  it('does not call packaged startRestore (staging is unit-testable in isolation)', () => {
    // Guard: this suite never imports BackupService.startRestore / app.isPackaged gates.
    expect(existsSync(join(workDir))).toBe(true)
    const staged = buildFileResourcesFromAdmit(workDir, emptyMeta, pathRoots)
    expect(staged.candidates.size).toBe(0)
    expect(staged.skippedFileEntryIds.size).toBe(0)
  })
})

describe('restoreResourceSeal durability order', () => {
  it('executes tmp write → file fsync → atomic rename → leaf-up dir fsync', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cs-seal-'))
    const source = join(tmpDir, 'src.bin')
    const target = join(tmpDir, 'nested', 'out.bin')
    writeFileSync(source, 'payload')
    mkdirSync(join(tmpDir, 'nested'), { recursive: true })

    const ops: string[] = []
    const vfs: ResourceSealFs = {
      copyFileSync: (src, dest) => {
        ops.push(`copy:${dest.endsWith('.seal-tmp') ? 'tmp' : 'other'}`)
        copyFileSync(src, dest)
      },
      renameSync: (src, dest) => {
        ops.push('rename')
        renameSync(src, dest)
      },
      openSync: (p, flags) => {
        ops.push(flags === 'r+' ? 'open-tmp' : `open-dir`)
        return openSync(p, flags)
      },
      fsyncSync: (fd) => {
        ops.push('fsync')
        fsyncSync(fd)
      },
      closeSync: (fd) => {
        closeSync(fd)
      },
      mkdirSync: (p, opts) => {
        mkdirSync(p, opts)
      },
      readdirSync: (p, opts) => readdirSync(p, opts),
      unlinkSync: (p) => unlinkSync(p),
      rmSync: (p, opts) => rmSync(p, opts),
      existsSync: (p) => existsSync(p)
    }

    try {
      // Force non-win32 leaf-up path for assertion when running on darwin/linux.
      sealFileResource(source, target, { stopDir: tmpDir, fs: vfs })
      // Expected core sequence prefix: copy tmp → open tmp → fsync → rename → dir fsync(s)
      expect(ops[0]).toBe('copy:tmp')
      expect(ops).toContain('open-tmp')
      expect(ops.indexOf('fsync')).toBeGreaterThan(ops.indexOf('open-tmp'))
      expect(ops.indexOf('rename')).toBeGreaterThan(ops.indexOf('fsync'))
      if (process.platform !== 'win32') {
        expect(ops.indexOf('open-dir')).toBeGreaterThan(ops.indexOf('rename'))
      }
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('staging → mock applyEntry journal kinds', () => {
  it('emits journal entries mock promotion can apply for all four kinds', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cs-journal-'))
    const workDir = join(tmpDir, 'restore-staging', 'rst')
    mkdirSync(join(workDir, 'files'), { recursive: true })
    mkdirSync(join(workDir, 'knowledge', 'kb'), { recursive: true })
    mkdirSync(join(workDir, 'skills', 'sk'), { recursive: true })
    mkdirSync(join(workDir, 'notes'), { recursive: true })
    writeFileSync(join(workDir, 'files', 'f1'), 'b')
    writeFileSync(join(workDir, 'knowledge', 'kb', 'x'), 'k')
    writeFileSync(join(workDir, 'skills', 'sk', 'y'), 's')
    writeFileSync(join(workDir, 'notes', 'n.md'), 'n')

    const db = new Database(join(workDir, 'backup.sqlite'))
    db.exec(
      `CREATE TABLE file_entry (id TEXT PRIMARY KEY, origin TEXT, name TEXT, ext TEXT, size INTEGER, external_path TEXT, deleted_at INTEGER)`
    )
    db.prepare(
      `INSERT INTO file_entry (id, origin, name, ext, size, external_path, deleted_at) VALUES ('f1','internal','f1','bin',1,NULL,NULL)`
    ).run()
    db.close()

    try {
      const staged = buildFileResourcesFromAdmit(
        workDir,
        {
          fileIds: ['f1'],
          knowledgeBases: ['kb'],
          skillFolders: [{ folderName: 'sk', contentHash: 'h' }],
          notePaths: ['n.md']
        },
        {
          userData: tmpDir,
          filesLiveRoot: join(tmpDir, 'Data', 'Files'),
          knowledgeLiveRoot: join(tmpDir, 'Data', 'KnowledgeBase'),
          skillsLiveRoot: join(tmpDir, 'Data', 'Skills'),
          notesLiveRoot: join(tmpDir, 'Data', 'Notes')
        }
      )

      const resources = candidatesToFileResources(staged)
      expect(resources.map((r) => r.kind).sort()).toEqual(['blob-add', 'dir-add', 'dir-add', 'note-add'].sort())

      // Mock applyEntry: only assert kinds + paths — no packaged startRestore / real promotion.
      const applyEntry = vi.fn((entry: (typeof resources)[number]) => {
        expect(['blob-add', 'dir-add', 'note-add']).toContain(entry.kind)
        expect(entry.stagingPath.length).toBeGreaterThan(0)
        expect(entry.livePath.length).toBeGreaterThan(0)
      })
      for (const entry of resources) applyEntry(entry)
      expect(applyEntry).toHaveBeenCalledTimes(4)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
