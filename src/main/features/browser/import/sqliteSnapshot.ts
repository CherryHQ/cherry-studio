import { chmod, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import Database from 'better-sqlite3'

export async function withBrowserSnapshot<T>(
  file: string,
  signal: AbortSignal,
  read: (db: Database.Database) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(application.getPath('feature.browser.import.temp', 'snapshot-'))
  let source: Database.Database | undefined
  let snapshot: Database.Database | undefined
  try {
    signal.throwIfAborted()
    source = new Database(file, { readonly: true, fileMustExist: true, timeout: 1_000 })
    const destination = path.join(directory, 'profile.sqlite')
    await source.backup(destination, {
      progress: () => {
        signal.throwIfAborted()
        return 100
      }
    })
    source.close()
    source = undefined
    await chmod(destination, 0o600)
    snapshot = new Database(destination, { readonly: true, fileMustExist: true })
    return await read(snapshot)
  } finally {
    snapshot?.close()
    source?.close()
    await rm(directory, { recursive: true, force: true })
  }
}
