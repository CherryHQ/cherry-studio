import type * as NodeFsModule from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import type { MiniAppManifest } from '@shared/types/miniAppManifest'

import { clearPublishJournal, recoverInterruptedPublishes, writePublishJournal } from '../publishJournal'
import { withPublishLock } from '../publishLock'

const A = 'com.example.a'

/**
 * Directory-fsync fault injection. `fsyncJournalDir` opens the directory with
 * `openSync(dir, 'r')` before fsyncing, so failing that open models the filesystems that
 * reject directory fsync outright — and unlike `fsyncSync` the open carries the PATH, so
 * the predicate can name the journal directory. A pass-through mock, because an ESM
 * namespace cannot be spied on; inert while the predicate is null.
 */
const fsyncDir = vi.hoisted(() => ({
  shouldFail: null as ((dir: string) => boolean) | null,
  /** Every directory a flush was attempted on — the only seam that observes the fsync at all. */
  attempted: [] as string[],
  /** Paths whose OWN descriptor was fsynced, so "flushed the bytes" is distinguishable. */
  flushedFiles: [] as string[]
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsModule>()
  const pathOfFd = new Map<number, string>()
  const openSync = (...args: Parameters<typeof actual.openSync>) => {
    const [target, flags] = args
    if (typeof target === 'string' && flags === 'r') {
      fsyncDir.attempted.push(target)
      if (fsyncDir.shouldFail?.(target)) {
        throw Object.assign(new Error('ENOTSUP: injected directory fsync-open failure'), { code: 'ENOTSUP' })
      }
    }
    const fd = actual.openSync(...args)
    if (typeof target === 'string' && flags === 'w') pathOfFd.set(fd, target)
    return fd
  }
  const fsyncSync = (fd: number) => {
    const target = pathOfFd.get(fd)
    if (target) fsyncDir.flushedFiles.push(target)
    return actual.fsyncSync(fd)
  }
  return { ...actual, default: { ...actual, openSync, fsyncSync }, openSync, fsyncSync }
})

/** `manifest_json` is `$type<MiniAppManifest>()`, so a partial object does not typecheck. */
const manifestOf = (appId: string): MiniAppManifest => ({
  id: appId,
  name: { en: appId },
  description: { en: appId },
  version: '1.0.0',
  entry: 'index.html',
  permissions: [],
  optionalPermissions: [],
  network: []
})

describe('publish journal', () => {
  const dbh = setupTestDatabase()
  let root: string

  /**
   * One owned file reference, plus the rows its foreign keys need. This is the witness a
   * clear-data commits by, so a case about the UNcommitted side has to be able to leave one.
   */
  const insertFileRef = (appId: string) => {
    const entryId = '11111111-1111-7111-8111-111111111111'
    dbh.db.insert(fileEntryTable).values({ id: entryId, origin: 'internal', name: 'blob', ext: 'bin', size: 4 }).run()
    dbh.db.insert(miniAppFileRefTable).values({ fileEntryId: entryId, sourceId: appId, logicalName: 'save.bin' }).run()
  }

  /** `previousContentHash` is what an UPDATE records and a reinstall deliberately does not. */
  const seedCommitted = (appId: string, contentHash: string, previousContentHash?: string) => {
    dbh.db
      .insert(miniAppTable)
      .values({
        appId,
        kind: 'app',
        presetMiniAppId: null,
        name: appId,
        url: `cherry-miniapp://${appId}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId,
        version: '1.0.0',
        contentHash,
        source: 'file',
        manifestJson: manifestOf(appId),
        ...(previousContentHash
          ? {
              previousContentHash,
              previousManifestJson: manifestOf(appId),
              previousGrantsJson: [],
              previousConsentedDeclaredJson: []
            }
          : {})
      })
      .run()
  }

  /** Writes a journal file byte-for-byte, for the cases that need a BAD one. */
  const writeRawJournal = (appId: string, raw: string) => {
    const dir = path.join(root, '.publish-journal')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${appId}.json`), raw)
  }

  const makeDir = (name: string, marker = name) => {
    const dir = path.join(root, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'marker'), marker)
    return dir
  }
  const markerIn = (name: string) => fs.readFileSync(path.join(root, name, 'marker'), 'utf8')

  afterEach(() => {
    fsyncDir.shouldFail = null
    fsyncDir.attempted.length = 0
    fsyncDir.flushedFiles.length = 0
    fs.rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-journal-'))
    // Key-aware AND filename-aware: ignoring either collapses every journal onto
    // the packages root — `writeFileSync` on a directory.
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const dir =
        key === 'feature.mini_app.publish_journal'
          ? path.join(root, '.publish-journal')
          : key === 'feature.mini_app.data'
            ? path.join(root, 'data')
            : root
      return filename ? path.join(dir, filename) : dir
    })
  })

  it('deletes a directory whose rows never committed', async () => {
    makeDir(A)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(fs.existsSync(path.join(root, A))).toBe(false)
  })

  it('KEEPS a directory whose rows did commit — the crash was after the commit', async () => {
    // The bug this guards: an unconditional delete destroys a successfully installed
    // app, and its appId can never be reused because the row survives.
    makeDir(A)
    seedCommitted(A, 'sha256:new')
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(path.join(root, A))).toBe(true)
  })

  it('rolls back an install whose row belongs to a DIFFERENT content hash', async () => {
    makeDir(A)
    seedCommitted(A, 'sha256:other')
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(fs.existsSync(path.join(root, A))).toBe(false)
  })

  it('restores the backup when an update did not commit', async () => {
    makeDir(A, 'new')
    makeDir(`${A}.backup`, 'old')
    seedCommitted(A, 'sha256:old')
    writePublishJournal({ kind: 'update', appId: A, contentHash: 'sha256:new' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(markerIn(A)).toBe('old')
    expect(fs.existsSync(path.join(root, `${A}.backup`))).toBe(false)
  })

  it('restores the backup even when the new tree never landed', async () => {
    makeDir(`${A}.backup`, 'old')
    seedCommitted(A, 'sha256:old')
    writePublishJournal({ kind: 'update', appId: A, contentHash: 'sha256:new' })

    await recoverInterruptedPublishes()

    expect(markerIn(A)).toBe('old')
  })

  it('keeps the retained backup when the update DID commit', async () => {
    makeDir(A, 'new')
    makeDir(`${A}.backup`, 'old')
    seedCommitted(A, 'sha256:new', 'sha256:old')
    writePublishJournal({ kind: 'update', appId: A, contentHash: 'sha256:new' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(path.join(root, `${A}.backup`))).toBe(true)
  })

  it('reclaims the parked tree of a reinstall that crashed before removing it', async () => {
    // A reinstall retains NO snapshot, so nothing can ever roll back to the parked tree.
    // Kept, it is a directory no code path will read and one the panel still reports as a
    // rollback snapshot under "Space".
    makeDir(A, 'new')
    makeDir(`${A}.backup`, 'parked')
    seedCommitted(A, 'sha256:new')
    writePublishJournal({
      kind: 'reinstall',
      appId: A,
      contentHash: 'sha256:new',
      previousContentHash: 'sha256:old'
    })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(path.join(root, `${A}.backup`))).toBe(false)
  })

  it('restores the parked tree when a same-version reinstall cannot witness its own commit', async () => {
    // `hashTree` reads content only, so re-extracting the SAME version reproduces the hash
    // the row already holds. A hash-only witness therefore answers "committed" from the
    // moment the journal is written, and a crash between the two renames would be rolled
    // FORWARD — leaving `installPath` missing for good with the only copy parked in
    // `.backup`, which nothing repairs afterwards. `previousContentHash` is what makes the
    // degenerate case recognisable; restoring is right on both sides, because two trees
    // with the same hash are the same bytes.
    makeDir(`${A}.backup`, 'parked')
    seedCommitted(A, 'sha256:same')
    writePublishJournal({
      kind: 'reinstall',
      appId: A,
      contentHash: 'sha256:same',
      previousContentHash: 'sha256:same'
    })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(markerIn(A)).toBe('parked')
  })

  it('keeps the previous version retrievable when a rollback did not commit', async () => {
    // The bug this guards: restoring `.rolling` by deleting `install` destroys the
    // previous version while the rows still promise a rollback.
    makeDir(A, 'old')
    makeDir(`${A}.rolling`, 'new')
    seedCommitted(A, 'sha256:new')
    writePublishJournal({ kind: 'rollback', appId: A, contentHash: 'sha256:old' })

    await recoverInterruptedPublishes()

    expect(markerIn(A)).toBe('new')
    expect(markerIn(`${A}.backup`)).toBe('old')
  })

  it('restores the NEW tree when a rollback did not commit', async () => {
    // The bug this guards: reusing the `update` state for rollback. `.backup` is
    // already consumed, so the repair finds nothing and leaves old files under new rows.
    makeDir(A, 'old')
    makeDir(`${A}.rolling`, 'new')
    seedCommitted(A, 'sha256:new')
    writePublishJournal({ kind: 'rollback', appId: A, contentHash: 'sha256:old' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(markerIn(A)).toBe('new')
  })

  it('drops the retained tree when a rollback DID commit', async () => {
    makeDir(A, 'old')
    makeDir(`${A}.rolling`, 'new')
    seedCommitted(A, 'sha256:old')
    writePublishJournal({ kind: 'rollback', appId: A, contentHash: 'sha256:old' })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(markerIn(A)).toBe('old')
    expect(fs.existsSync(path.join(root, `${A}.rolling`))).toBe(false)
  })

  it('reclaims the directory of an uninstall whose rows are already gone', async () => {
    // The bug this guards: rows deleted, process killed, directory left behind —
    // and the installer then refuses that appId forever because the directory exists.
    makeDir(A)
    makeDir(`${A}.backup`)
    writePublishJournal({ kind: 'uninstall', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(path.join(root, A))).toBe(false)
    expect(fs.existsSync(path.join(root, `${A}.backup`))).toBe(false)
  })

  it('removes the save data of an uninstall whose rows are already gone', async () => {
    // The bug this guards: recovery reclaiming only the package trees. `data/<appId>` is
    // a sibling of `packages/`, and a reinstall of the same id would read the old save.
    makeDir(A)
    const data = path.join(root, 'data', A)
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'storage.json'), '{"score":"9000"}')
    writePublishJournal({ kind: 'uninstall', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(data)).toBe(false)
  })

  it('finishes a clear-data that was interrupted after its rows committed', async () => {
    // "Clear data" deletes the reference rows first and the stores after, so a crash in
    // between leaves the files unlisted while `storage.json` and the partition survive —
    // the app reads its old state straight back out of a clear the user watched succeed.
    const data = path.join(root, 'data', A)
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'storage.json'), '{"score":"9000"}')
    makeDir(A)
    writePublishJournal({ kind: 'clear-data', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(fs.existsSync(data)).toBe(false)
    expect(session.fromPartition(`persist:miniapp:${A}`).clearStorageData).toHaveBeenCalled()
    // The package tree is NOT a store the app wrote: clearing data leaves it installed.
    expect(fs.existsSync(path.join(root, A))).toBe(true)
  })

  it('leaves a clear-data alone when its reference delete never committed', async () => {
    // The witness matters precisely here: the journal is armed BEFORE the delete, so a crash
    // in between must repair to "nothing happened". Clearing anyway would strand the app
    // with its file refs listed on the files page and its save data gone.
    const data = path.join(root, 'data', A)
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'storage.json'), '{"score":"9000"}')
    // Still installed — clearing data never removes the app, which is why the installation
    // row cannot be the witness and the reference rows are.
    seedCommitted(A, 'sha256:x')
    insertFileRef(A)
    writePublishJournal({ kind: 'clear-data', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(fs.existsSync(data)).toBe(true)
  })

  it('clears the session partition of an uninstall whose rows are already gone', async () => {
    // The OTHER store nothing cascades. Cookies and the HTTP cache live on the partition,
    // not under `packages/` or `data/`, so a recovery that reclaims only directories leaves
    // an uninstalled app's server identity intact for the next install of the same id.
    makeDir(A)
    writePublishJournal({ kind: 'uninstall', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-forward' }])
    expect(vi.mocked(session.fromPartition)).toHaveBeenCalledWith(`persist:miniapp:${A}`)
    expect(session.fromPartition(`persist:miniapp:${A}`).clearStorageData).toHaveBeenCalled()
  })

  it('leaves the files alone when an uninstall never committed', async () => {
    makeDir(A)
    seedCommitted(A, 'sha256:new')
    writePublishJournal({ kind: 'uninstall', appId: A })

    expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
    expect(fs.existsSync(path.join(root, A))).toBe(true)
  })

  it('leaves a cleared entry alone', async () => {
    makeDir(A)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })
    clearPublishJournal(A)

    expect(await recoverInterruptedPublishes()).toEqual([])
    expect(fs.existsSync(path.join(root, A))).toBe(true)
  })

  it('is idempotent — recovering twice is a no-op', async () => {
    makeDir(A)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })

    await recoverInterruptedPublishes()
    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
  })

  it('keeps both journals when two apps publish at once', async () => {
    // THE bug per-app files make unrepresentable: publishes are serialized per appId, so
    // two apps can be mid-publish together and one shared file loses the other's entry.
    const B = 'com.example.b'
    makeDir(A)
    makeDir(B)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:a' })
    writePublishJournal({ kind: 'install', appId: B, contentHash: 'sha256:b' })

    const recovered = await recoverInterruptedPublishes()

    expect(recovered.map((r) => r.appId).sort()).toEqual([A, B])
    expect(fs.existsSync(path.join(root, A))).toBe(false)
    expect(fs.existsSync(path.join(root, B))).toBe(false)
  })

  // A real EACCES rather than a stubbed `rm`: `force: true` swallows ENOENT and nothing
  // else, and the mode bits are what make the difference observable. Root ignores them.
  const deniesByMode = process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!deniesByMode)('reports the app it could not repair and leaves its journal armed', async () => {
    // The fail-open this closes: the repair throws, is logged, and is skipped — so a caller
    // that only learns recovery FINISHED admits a guest to the tree the crash left behind.
    const B = 'com.example.b'
    const stuck = makeDir(A)
    makeDir(B)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:a' })
    writePublishJournal({ kind: 'install', appId: B, contentHash: 'sha256:b' })
    fs.chmodSync(stuck, 0o555)

    try {
      const outcomes = await recoverInterruptedPublishes()

      expect(outcomes).toContainEqual({ appId: A, action: 'failed' })
      expect(fs.existsSync(path.join(root, '.publish-journal', `${A}.json`))).toBe(true)
      // Isolated, in the same run: one app's EACCES is not the other's, and B's journal goes.
      expect(outcomes).toContainEqual({ appId: B, action: 'rolled-back' })
      expect(fs.existsSync(path.join(root, B))).toBe(false)
    } finally {
      fs.chmodSync(stuck, 0o755)
    }
  })

  it.skipIf(!deniesByMode)('keeps going when a repaired entry’s journal will not clear', async () => {
    // `clearPublishJournal` used to sit outside the per-entry catch, so one unwritable
    // journal threw past the loop and left every LATER app unrepaired AND unreported.
    const B = 'com.example.b'
    makeDir(A)
    makeDir(B)
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:a' })
    writePublishJournal({ kind: 'install', appId: B, contentHash: 'sha256:b' })
    const journalDir = path.join(root, '.publish-journal')
    fs.chmodSync(journalDir, 0o555)

    try {
      const outcomes = await recoverInterruptedPublishes()

      // Both entries reached, and both fail closed: the trees went, but an entry that will
      // replay on the next launch is not one this launch may admit a guest against.
      expect(outcomes.map((o) => `${o.appId}:${o.action}`).sort()).toEqual([`${A}:failed`, `${B}:failed`])
      expect(fs.existsSync(path.join(root, A))).toBe(false)
      expect(fs.existsSync(path.join(root, B))).toBe(false)
    } finally {
      fs.chmodSync(journalDir, 0o755)
    }
  })

  it('discards a journal whose payload names a different app than its file', async () => {
    // `clearPublishJournal` deletes by the PAYLOAD's appId, so a mismatched pair can never
    // retire itself — it would repair the other app's trees on every launch, for ever.
    const B = 'com.example.b'
    makeDir(B)
    writeRawJournal(A, JSON.stringify({ kind: 'install', appId: B, contentHash: 'sha256:b' }))

    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
    expect(fs.existsSync(path.join(root, B))).toBe(true)
  })

  it('flushes the journal file before the rename that arms it', () => {
    // Arming the marker is what a power cut may not lose — it is written BEFORE the files
    // move. The bytes and not just the directory entry: an entry pointing at an empty file
    // witnesses nothing, and `readOne` discards what it cannot parse.
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:a' })

    const journalFile = path.join(root, '.publish-journal', `${A}.json`)
    expect(fsyncDir.flushedFiles.some((f) => f.startsWith(journalFile))).toBe(true)
  })

  // Windows moves are write-through and directory handles cannot be fsynced, so production
  // skips the flush there — there is nothing to observe and nothing to tolerate.
  it.skipIf(process.platform === 'win32')(
    'flushes the journal directory, and publishes anyway when the filesystem refuses',
    async () => {
      // userData can be relocated onto a network mount or FUSE backend that rejects
      // directory fsync outright, and failing the publish there is the worse bug of the two.
      const journalDir = path.join(root, '.publish-journal')
      fsyncDir.shouldFail = (dir) => dir === journalDir
      makeDir(A)

      expect(() => writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:a' })).not.toThrow()
      expect(fsyncDir.attempted).toContain(journalDir)

      // Retiring it is flushed too, and recovery still gets through: an intolerant version
      // would throw here instead, which now also marks the app unrepaired.
      fsyncDir.attempted.length = 0
      expect(await recoverInterruptedPublishes()).toEqual([{ appId: A, action: 'rolled-back' }])
      expect(fsyncDir.attempted).toContain(journalDir)
      expect(fs.existsSync(path.join(journalDir, `${A}.json`))).toBe(false)
    }
  )

  it('survives a corrupt journal file instead of blocking startup', async () => {
    writeRawJournal(A, '{ not json')
    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
  })

  it('discards a file whose shape does not validate', async () => {
    // A hand-edited or half-written journal must not steer a recursive delete.
    writeRawJournal(A, JSON.stringify({ kind: 'install' }))
    makeDir(A)

    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
    expect(fs.existsSync(path.join(root, A))).toBe(true)
  })

  it('refuses a journal whose appId would escape the mini app root', async () => {
    // The bug this guards: the appId is joined onto the packages root and the result is
    // an `rm -rf` target, so a loose `z.string()` lets `../..` out.
    const outside = path.join(root, '..', 'do-not-delete')
    fs.mkdirSync(outside, { recursive: true })
    writeRawJournal(A, JSON.stringify({ kind: 'install', appId: '../do-not-delete', contentHash: 'sha256:x' }))

    await expect(recoverInterruptedPublishes()).resolves.toEqual([])
    expect(fs.existsSync(outside)).toBe(true)
    fs.rmSync(outside, { recursive: true, force: true })
  })

  it('never leaves a half-written journal behind', async () => {
    writePublishJournal({ kind: 'install', appId: A, contentHash: 'sha256:new' })
    writePublishJournal({ kind: 'install', appId: 'com.example.b', contentHash: 'sha256:b' })

    const dir = path.join(root, '.publish-journal')
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      expect(() => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))).not.toThrow()
    }
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('withPublishLock', () => {
  it('runs two actions on one app strictly in sequence', async () => {
    const order: string[] = []
    const slow = async () => {
      order.push('a:start')
      await new Promise((r) => setTimeout(r, 10))
      order.push('a:end')
    }
    const fast = async () => {
      order.push('b')
    }

    await Promise.all([withPublishLock(A, slow), withPublishLock(A, fast)])

    expect(order).toEqual(['a:start', 'a:end', 'b'])
  })

  it('does not serialize different apps against each other', async () => {
    const order: string[] = []
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push('slow')
    }
    const fast = async () => {
      order.push('fast')
    }

    await Promise.all([withPublishLock(A, slow), withPublishLock('com.example.b', fast)])

    expect(order).toEqual(['fast', 'slow'])
  })

  it('keeps running after a failed action', async () => {
    // The bug this guards: chaining off the value poisons the chain, so one failed
    // install makes every later action on that app hang or reject forever.
    await expect(
      withPublishLock(A, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    await expect(withPublishLock(A, async () => 'ok')).resolves.toBe('ok')
  })
})
