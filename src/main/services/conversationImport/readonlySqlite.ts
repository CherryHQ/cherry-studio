import { lstat, open } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export async function statIfPresent(file: string) {
  try {
    return await lstat(file)
  } catch (error) {
    if (!missing(error)) throw error
    return undefined
  }
}

// A clean close can leave a WAL header without sidecars. Read that checkpoint without creating files.
export async function queryReadonlyDatabase<T>(file: string, query: (db: DatabaseSync) => T): Promise<T> {
  const before = await lstat(file, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('source_changed')
  const wal = await statIfPresent(file + '-wal')
  const shm = await statIfPresent(file + '-shm')
  if ((wal || shm) && (!wal?.isFile() || !shm?.isFile())) throw new Error('unsupported_readonly_wal')
  let checkpoint = false
  if (!wal && !shm) {
    const handle = await open(file, 'r')
    try {
      const header = Buffer.alloc(20)
      await handle.read(header, 0, header.length, 0)
      checkpoint = header[18] === 2
    } finally {
      await handle.close()
    }
  }
  const url = pathToFileURL(file)
  url.searchParams.set('mode', 'ro')
  if (checkpoint) url.searchParams.set('immutable', '1')
  const db = new DatabaseSync(url.href, { readOnly: true })
  try {
    db.exec('PRAGMA trusted_schema = OFF; BEGIN')
    const result = query(db)
    if (checkpoint) {
      const after = await lstat(file, { bigint: true })
      if (
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs ||
        (await statIfPresent(file + '-wal')) ||
        (await statIfPresent(file + '-shm'))
      )
        throw new Error('source_changed')
    }
    return result
  } finally {
    db.close()
  }
}
