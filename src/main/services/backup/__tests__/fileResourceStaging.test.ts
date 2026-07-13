import * as fs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ArchiveContext } from '../admitArchive'
import { finalizeFileResources, stageFileResources, type StagedFileResourceCandidate } from '../fileResourceStaging'
import type { BackupManifest } from '../manifest'
import type { MergeResult } from '../merge'
import { sealRestoreResource, type RestoreResourceFileSystem } from '../restoreResourceSeal'

const emptyMergeResult = (): MergeResult => ({
  degradedToSkips: [],
  acceptedFileEntryIds: [],
  acceptedFileRefFileEntryIds: [],
  survivingFileEntries: new Map()
})

/** Build the minimal unpacked archive database required by pre-merge resource staging. */
function createArchiveContext(
  root: string,
  options: {
    readonly rows: readonly { readonly id: string; readonly ext: string | null }[]
    readonly manifestIds: readonly string[]
    readonly payloads?: Readonly<Record<string, string>>
    readonly includeFiles?: boolean
  }
): ArchiveContext {
  const archiveRoot = join(root, 'archive')
  const backupDbPath = join(archiveRoot, 'backup.sqlite')
  mkdirSync(join(archiveRoot, 'files'), { recursive: true })
  const db = new Database(backupDbPath)
  try {
    db.exec('CREATE TABLE file_entry (id TEXT PRIMARY KEY, ext TEXT, deleted_at INTEGER)')
    const insert = db.prepare('INSERT INTO file_entry (id, ext, deleted_at) VALUES (?, ?, NULL)')
    for (const row of options.rows) insert.run(row.id, row.ext)
  } finally {
    db.close()
  }
  for (const [id, contents] of Object.entries(options.payloads ?? {})) {
    writeFileSync(join(archiveRoot, 'files', id), contents)
  }
  return {
    backupDbPath,
    manifest: {} as BackupManifest,
    domains: ['FILE_STORAGE'],
    includeFiles: options.includeFiles ?? true,
    resourceMetadata: { fileIds: [...options.manifestIds], knowledgeBases: [], notePaths: [] }
  }
}

describe('file resource staging', () => {
  let root: string
  let userData: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-file-resource-'))
    userData = join(root, 'userData')
    mkdirSync(userData)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const createCandidate = (id: string, contents = Buffer.from('archive blob')): StagedFileResourceCandidate => {
    const stagedPath = join(userData, 'restore-staging', 'restore-1', 'resources', 'files', id)
    const livePath = join(userData, 'Data', 'Files', `${id}.txt`)
    sealRestoreResource(join(userData, 'restore-staging', 'restore-1', 'resources'), stagedPath, contents)
    return {
      stagedPath,
      kind: 'blob-add',
      livePath,
      ext: 'txt',
      rewrite: { origin: 'internal', externalPath: null, size: contents.byteLength }
    }
  }

  it('emits blob-add only for an accepted file-entry candidate', () => {
    const candidate = createCandidate('file-accepted')

    const resources = finalizeFileResources({
      candidates: new Map([['file-accepted', candidate]]),
      mergeResult: { ...emptyMergeResult(), acceptedFileEntryIds: ['file-accepted'] },
      userData
    })

    expect(resources).toEqual([
      {
        kind: 'blob-add',
        stagingPath: join('restore-staging', 'restore-1', 'resources', 'files', 'file-accepted'),
        livePath: join('Data', 'Files', 'file-accepted.txt')
      }
    ])
    expect(existsSync(candidate.stagedPath)).toBe(true)
  })

  it('removes a candidate rejected by merge without emitting a journal entry', () => {
    const candidate = createCandidate('file-rejected')

    const resources = finalizeFileResources({
      candidates: new Map([['file-rejected', candidate]]),
      mergeResult: emptyMergeResult(),
      userData
    })

    expect(resources).toEqual([])
    expect(existsSync(candidate.stagedPath)).toBe(false)
  })

  it('reuses a matching live orphan and removes its staged duplicate', () => {
    const contents = Buffer.from('matching orphan')
    const candidate = createCandidate('file-orphan', contents)
    mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
    writeFileSync(candidate.livePath, contents)

    const resources = finalizeFileResources({
      candidates: new Map([['file-orphan', candidate]]),
      mergeResult: { ...emptyMergeResult(), acceptedFileEntryIds: ['file-orphan'] },
      userData
    })

    expect(resources).toEqual([])
    expect(existsSync(candidate.stagedPath)).toBe(false)
  })

  it('rejects an accepted candidate when a live orphan differs', () => {
    const candidate = createCandidate('file-conflict', Buffer.from('archive'))
    mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
    writeFileSync(candidate.livePath, 'different live blob')

    expect(() =>
      finalizeFileResources({
        candidates: new Map([['file-conflict', candidate]]),
        mergeResult: { ...emptyMergeResult(), acceptedFileEntryIds: ['file-conflict'] },
        userData
      })
    ).toThrow(/conflicts with staged blob/)
  })

  it('skips DB rows missing either manifest metadata or archive payloads', async () => {
    const archive = createArchiveContext(root, {
      rows: [
        { id: 'missing-manifest', ext: 'txt' },
        { id: 'missing-payload', ext: null }
      ],
      manifestIds: ['missing-payload'],
      payloads: { 'missing-manifest': 'blob' }
    })

    const result = await stageFileResources({
      archive,
      backupRoot: join(userData, 'restore-staging', 'restore-drift', 'resources'),
      liveFileRoot: join(userData, 'Data', 'Files')
    })

    expect(result.candidates).toEqual(new Map())
    expect(result.skippedFileEntryIds).toEqual(new Set(['missing-manifest', 'missing-payload']))
  })

  it('does not construct or remove a staging path for an unsafe database file id', async () => {
    const unsafeId = '../../../../victim'
    const backupRoot = join(userData, 'restore-staging', 'nested', 'restore-unsafe-id', 'resources')
    const victimPath = resolve(backupRoot, 'files', unsafeId)
    mkdirSync(join(victimPath, '..'), { recursive: true })
    writeFileSync(victimPath, 'must survive')
    const archive = createArchiveContext(root, {
      rows: [{ id: unsafeId, ext: 'txt' }],
      manifestIds: [unsafeId]
    })

    const result = await stageFileResources({
      archive,
      backupRoot,
      liveFileRoot: join(userData, 'Data', 'Files')
    })

    expect(result.candidates).toEqual(new Map())
    expect(result.skippedFileEntryIds).toEqual(new Set([unsafeId]))
    expect(readFileSync(victimPath, 'utf8')).toBe('must survive')
  })

  it('skips an archive extension that would escape the managed live root', async () => {
    const archive = createArchiveContext(root, {
      rows: [{ id: 'unsafe-extension', ext: '../outside' }],
      manifestIds: ['unsafe-extension'],
      payloads: { 'unsafe-extension': 'blob' }
    })

    const result = await stageFileResources({
      archive,
      backupRoot: join(userData, 'restore-staging', 'restore-unsafe-extension', 'resources'),
      liveFileRoot: join(userData, 'Data', 'Files')
    })

    expect(result.candidates).toEqual(new Map())
    expect(result.skippedFileEntryIds).toEqual(new Set(['unsafe-extension']))
  })

  it('defers a live target symlink conflict until merge evidence is available', async () => {
    const liveFileRoot = join(userData, 'Data', 'Files')
    const outside = join(root, 'outside-blob')
    mkdirSync(liveFileRoot, { recursive: true })
    writeFileSync(outside, 'outside')
    fs.symlinkSync(outside, join(liveFileRoot, 'symlink-target.txt'))
    const archive = createArchiveContext(root, {
      rows: [{ id: 'symlink-target', ext: 'txt' }],
      manifestIds: ['symlink-target'],
      payloads: { 'symlink-target': 'blob' }
    })

    const result = await stageFileResources({
      archive,
      backupRoot: join(userData, 'restore-staging', 'restore-symlink-target', 'resources'),
      liveFileRoot
    })

    const candidate = result.candidates.get('symlink-target')
    expect(candidate).toBeDefined()
    expect(result.skippedFileEntryIds).toEqual(new Set())
    expect(() =>
      finalizeFileResources({
        candidates: result.candidates,
        mergeResult: { ...emptyMergeResult(), acceptedFileEntryIds: ['symlink-target'] },
        userData
      })
    ).toThrow(/add target is unsafe/)
  })

  it('rejects a lite archive that declares file metadata or payloads', async () => {
    const archive = createArchiveContext(root, {
      rows: [],
      manifestIds: ['unexpected-file'],
      payloads: { 'unexpected-file': 'blob' },
      includeFiles: false
    })

    await expect(
      stageFileResources({
        archive,
        backupRoot: join(userData, 'restore-staging', 'restore-lite', 'resources'),
        liveFileRoot: join(userData, 'Data', 'Files')
      })
    ).rejects.toThrow(/lite archive/)
  })

  it('rejects a lite archive whose selected database rows require file payloads', async () => {
    const archive = createArchiveContext(root, {
      rows: [{ id: 'db-only-file', ext: 'txt' }],
      manifestIds: [],
      includeFiles: false
    })

    await expect(
      stageFileResources({
        archive,
        backupRoot: join(userData, 'restore-staging', 'restore-lite-db-row', 'resources'),
        liveFileRoot: join(userData, 'Data', 'Files')
      })
    ).rejects.toThrow(/lite archive/)
  })

  it('returns an empty stage for a consistent lite archive', async () => {
    const archive = createArchiveContext(root, {
      rows: [],
      manifestIds: [],
      includeFiles: false
    })

    await expect(
      stageFileResources({
        archive,
        backupRoot: join(userData, 'restore-staging', 'restore-lite-empty', 'resources'),
        liveFileRoot: join(userData, 'Data', 'Files')
      })
    ).resolves.toEqual({ candidates: new Map(), skippedFileEntryIds: new Set() })
  })

  it('skips an external file entry with no archive payload before merge', async () => {
    const archive = createArchiveContext(root, {
      rows: [{ id: 'external-missing', ext: 'pdf' }],
      manifestIds: ['external-missing']
    })

    const result = await stageFileResources({
      archive,
      backupRoot: join(userData, 'restore-staging', 'restore-external', 'resources'),
      liveFileRoot: join(userData, 'Data', 'Files')
    })

    expect(result.candidates.has('external-missing')).toBe(false)
    expect(result.skippedFileEntryIds).toEqual(new Set(['external-missing']))
  })

  it('removes a skipped internal candidate when the surviving local blob already exists', () => {
    const candidate = createCandidate('local-present')
    mkdirSync(join(userData, 'Data', 'Files'), { recursive: true })
    writeFileSync(candidate.livePath, 'local blob')

    const resources = finalizeFileResources({
      candidates: new Map([['local-present', candidate]]),
      mergeResult: {
        ...emptyMergeResult(),
        survivingFileEntries: new Map([['local-present', { origin: 'internal', ext: 'txt', deletedAt: null }]])
      },
      userData
    })

    expect(resources).toEqual([])
    expect(existsSync(candidate.stagedPath)).toBe(false)
  })

  it('preserves a differing local blob when SKIP keeps the local file entry', async () => {
    const liveFileRoot = join(userData, 'Data', 'Files')
    mkdirSync(liveFileRoot, { recursive: true })
    const livePath = join(liveFileRoot, 'local-wins.txt')
    writeFileSync(livePath, 'newer local blob')
    const archive = createArchiveContext(root, {
      rows: [{ id: 'local-wins', ext: 'txt' }],
      manifestIds: ['local-wins'],
      payloads: { 'local-wins': 'older archive blob' }
    })

    const staged = await stageFileResources({
      archive,
      backupRoot: join(userData, 'restore-staging', 'restore-local-wins', 'resources'),
      liveFileRoot
    })
    const candidate = staged.candidates.get('local-wins')
    expect(candidate).toBeDefined()
    expect(staged.skippedFileEntryIds).toEqual(new Set())

    const resources = finalizeFileResources({
      candidates: staged.candidates,
      mergeResult: {
        ...emptyMergeResult(),
        acceptedFileRefFileEntryIds: ['local-wins'],
        survivingFileEntries: new Map([['local-wins', { origin: 'internal', ext: 'txt', deletedAt: null }]])
      },
      userData
    })

    expect(resources).toEqual([])
    expect(readFileSync(livePath, 'utf8')).toBe('newer local blob')
    expect(existsSync(candidate?.stagedPath ?? '')).toBe(false)
  })

  it('retains a skipped internal candidate when a new reference needs a missing local blob', () => {
    const candidate = createCandidate('local-missing')

    const resources = finalizeFileResources({
      candidates: new Map([['local-missing', candidate]]),
      mergeResult: {
        ...emptyMergeResult(),
        acceptedFileRefFileEntryIds: ['local-missing'],
        survivingFileEntries: new Map([['local-missing', { origin: 'internal', ext: 'bin', deletedAt: null }]])
      },
      userData
    })

    expect(resources).toEqual([
      {
        kind: 'blob-add',
        stagingPath: join('restore-staging', 'restore-1', 'resources', 'files', 'local-missing'),
        livePath: join('Data', 'Files', 'local-missing.bin')
      }
    ])
    expect(existsSync(candidate.stagedPath)).toBe(true)
  })

  it('aborts when a newly referenced internal survivor has an unsafe live target', () => {
    const candidate = createCandidate('unsafe-survivor')
    const unsafeTarget = join(userData, 'Data', 'Files', 'unsafe-survivor.bin')
    mkdirSync(unsafeTarget, { recursive: true })

    expect(() =>
      finalizeFileResources({
        candidates: new Map([['unsafe-survivor', candidate]]),
        mergeResult: {
          ...emptyMergeResult(),
          acceptedFileRefFileEntryIds: ['unsafe-survivor'],
          survivingFileEntries: new Map([['unsafe-survivor', { origin: 'internal', ext: 'bin', deletedAt: null }]])
        },
        userData
      })
    ).toThrow(/survivor target is unsafe/)
    expect(existsSync(candidate.stagedPath)).toBe(true)
  })

  it('aborts when a newly referenced internal survivor path cannot be resolved safely', () => {
    const candidate = createCandidate('unsafe-survivor-path')

    expect(() =>
      finalizeFileResources({
        candidates: new Map([['unsafe-survivor-path', candidate]]),
        mergeResult: {
          ...emptyMergeResult(),
          acceptedFileRefFileEntryIds: ['unsafe-survivor-path'],
          survivingFileEntries: new Map([
            ['unsafe-survivor-path', { origin: 'internal', ext: '../outside', deletedAt: null }]
          ])
        },
        userData
      })
    ).toThrow(/survivor path is unsafe/)
    expect(existsSync(candidate.stagedPath)).toBe(true)
  })

  it('removes skipped candidates whose local survivor is external or soft-deleted', () => {
    const external = createCandidate('local-external')
    const deleted = createCandidate('local-deleted')

    const resources = finalizeFileResources({
      candidates: new Map([
        ['local-external', external],
        ['local-deleted', deleted]
      ]),
      mergeResult: {
        ...emptyMergeResult(),
        acceptedFileRefFileEntryIds: ['local-external', 'local-deleted'],
        survivingFileEntries: new Map([
          ['local-external', { origin: 'external', ext: 'txt', deletedAt: null }],
          ['local-deleted', { origin: 'internal', ext: 'txt', deletedAt: Date.now() }]
        ])
      },
      userData
    })

    expect(resources).toEqual([])
    expect(existsSync(external.stagedPath)).toBe(false)
    expect(existsSync(deleted.stagedPath)).toBe(false)
  })

  it('writes a sealed resource below the staging root and rejects an escape', () => {
    const stagingRoot = join(userData, 'restore-staging', 'restore-1', 'resources')
    const target = join(stagingRoot, 'files', 'file-sealed')
    sealRestoreResource(stagingRoot, target, Buffer.from('sealed'))

    expect(readFileSync(target, 'utf8')).toBe('sealed')
    expect(() => sealRestoreResource(stagingRoot, join(root, 'escaped'), Buffer.from('blocked'))).toThrow(
      /escapes staging root/
    )
  })

  it('fsyncs staged bytes before rename, then directories from leaf to staging root', () => {
    const stagingRoot = join(userData, 'restore-staging', 'restore-order', 'resources')
    const target = join(stagingRoot, 'files', 'file-order')
    const operations: string[] = []
    const fileSystem: RestoreResourceFileSystem = {
      mkdirSync: (directory, options) => fs.mkdirSync(directory, options),
      realpathSync: (targetPath) => fs.realpathSync(targetPath),
      openSync: (targetPath, flags) => {
        if (flags === 'r') operations.push(`open:${targetPath}`)
        return fs.openSync(targetPath, flags)
      },
      copyFileSync: (source, destination, mode) => fs.copyFileSync(source, destination, mode),
      writeFileSync: (fd, contents) => {
        operations.push('write')
        fs.writeFileSync(fd, contents)
      },
      fsyncSync: (fd) => {
        operations.push('fsync')
        fs.fsyncSync(fd)
      },
      closeSync: (fd) => fs.closeSync(fd),
      renameSync: (from, to) => {
        operations.push('rename')
        fs.renameSync(from, to)
      },
      rmSync: (targetPath, options) => fs.rmSync(targetPath, options)
    }

    sealRestoreResource(stagingRoot, target, Buffer.from('ordered'), fileSystem)

    const realStagingRoot = fs.realpathSync(stagingRoot)
    expect(operations).toEqual([
      'write',
      'fsync',
      'rename',
      `open:${join(realStagingRoot, 'files')}`,
      'fsync',
      `open:${realStagingRoot}`,
      'fsync'
    ])
  })
})
