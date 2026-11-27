import { AsyncLocalStorage } from 'node:async_hooks'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtempDisposable } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import { application } from '@application'

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export async function statIfPresent(file: string) {
  try {
    return await lstat(file, { bigint: true })
  } catch (error) {
    if (!missing(error)) throw error
    return undefined
  }
}

const snapshots = new AsyncLocalStorage<{
  cleanup: AsyncDisposableStack
  copies: Map<string, { version: string; dir: Awaited<ReturnType<typeof mkdtempDisposable>> }>
}>()

export async function withReadonlyDatabaseSnapshots<T>(operation: () => Promise<T>) {
  await using cleanup = new AsyncDisposableStack()
  return await snapshots.run({ cleanup, copies: new Map() }, operation)
}

async function sourceState(file: string) {
  const [db, wal, shm, journal] = await Promise.all(
    [file, file + '-wal', file + '-shm', file + '-journal'].map(statIfPresent)
  )
  if (!db?.isFile() || (journal && (!journal.isFile() || journal.size > 0n))) throw new Error('source_changed')
  if ((wal || shm) && (!wal?.isFile() || !shm?.isFile())) throw new Error('unsupported_readonly_wal')
  const stamp = (stat: typeof db) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
  const main = stamp(db)
  return { main, version: main + '/' + (wal ? stamp(wal) : ''), hasWal: !!wal?.size }
}

async function copyWalSnapshot(file: string, target: string, initial: Awaited<ReturnType<typeof sourceState>>) {
  let state = initial
  let copiedMain: string | undefined
  for (let attempt = 0; attempt < 3 && state.hasWal; attempt++) {
    if (copiedMain !== state.main) {
      await copyFile(file, target, constants.COPYFILE_FICLONE)
      copiedMain = state.main
      state = await sourceState(file)
      if (state.main !== copiedMain || !state.hasWal) continue
    }
    // A writer may append to the WAL while the larger main file is copied. Only this shorter copy needs both stable.
    await copyFile(file + '-wal', target + '-wal', constants.COPYFILE_FICLONE)
    const after = await sourceState(file)
    if (after.version === state.version) return after.version
    state = after
  }
  throw new Error('source_changed')
}

export async function queryReadonlyDatabase<T>(file: string, query: (db: DatabaseSync) => T): Promise<T> {
  const scope = snapshots.getStore()
  if (!scope) return withReadonlyDatabaseSnapshots(() => queryReadonlyDatabase(file, query))
  const before = await sourceState(file)
  let target = file
  let copy = scope.copies.get(file)
  if (copy && copy.version !== before.version) {
    scope.copies.delete(file)
    await copy.dir.remove()
    copy = undefined
  }
  if (before.hasWal) {
    // SQLite may create sidecars even for a read-only connection. Let it rebuild its WAL index only on a private copy.
    if (!copy) {
      const parent = application.getPath('app.temp')
      await mkdir(parent, { recursive: true })
      const dir = scope.cleanup.use(await mkdtempDisposable(path.join(parent, 'history-sqlite-')))
      target = path.join(dir.path, 'snapshot.sqlite')
      try {
        const version = await copyWalSnapshot(file, target, before)
        copy = { dir, version }
        scope.copies.set(file, copy)
      } catch (error) {
        await dir.remove()
        if (missing(error)) throw new Error('source_changed')
        throw error
      }
    }
    target = path.join(copy.dir.path, 'snapshot.sqlite')
  }
  const url = pathToFileURL(target)
  url.searchParams.set('mode', 'ro')
  if (!before.hasWal) url.searchParams.set('immutable', '1')
  const db = new DatabaseSync(url.href, { readOnly: true })
  try {
    db.exec('PRAGMA trusted_schema = OFF; BEGIN')
    const result = query(db)
    if (!before.hasWal && (await sourceState(file)).version !== before.version) throw new Error('source_changed')
    return result
  } finally {
    db.close()
  }
}
