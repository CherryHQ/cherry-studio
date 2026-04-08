import { mountTable } from '@data/db/schemas/file'
import { getFilesDir, getNotesDir, getTempFilesDir } from '@main/utils/file'
import type { MountType, SystemKey } from '@shared/data/types/file'
import { sql } from 'drizzle-orm'

import type { DbType, ISeed } from '../types'

interface SystemMount {
  systemKey: SystemKey
  name: string
  mountType: MountType
  basePath: string | null
  watch: boolean | null
  watchExtensions: string[] | null
}

function getSystemMounts(): SystemMount[] {
  let filesDir: string
  let notesDir: string
  let tempDir: string
  try {
    filesDir = getFilesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount files: ${(err as Error).message}`)
  }
  try {
    notesDir = getNotesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount notes: ${(err as Error).message}`)
  }
  try {
    tempDir = getTempFilesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount temp: ${(err as Error).message}`)
  }

  return [
    {
      systemKey: 'files',
      name: 'Files',
      mountType: 'local_managed',
      basePath: filesDir,
      watch: null,
      watchExtensions: null
    },
    {
      systemKey: 'notes',
      name: 'Notes',
      mountType: 'local_external',
      basePath: notesDir,
      watch: true,
      watchExtensions: []
    },
    {
      systemKey: 'temp',
      name: 'Temp',
      mountType: 'local_managed',
      basePath: tempDir,
      watch: null,
      watchExtensions: null
    },
    {
      systemKey: 'trash',
      name: 'Trash',
      mountType: 'system',
      basePath: null,
      watch: null,
      watchExtensions: null
    }
  ]
}

class FileEntrySeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const systemMounts = getSystemMounts()
    // Upsert by systemKey: insert new system mounts or update config if paths changed
    for (const mount of systemMounts) {
      await db
        .insert(mountTable)
        .values(mount)
        .onConflictDoUpdate({
          target: mountTable.systemKey,
          set: {
            name: sql`excluded.name`,
            mountType: sql`excluded.mount_type`,
            basePath: sql`excluded.base_path`,
            watch: sql`excluded.watch`,
            watchExtensions: sql`excluded.watch_extensions`
          }
        })
    }
  }
}

export default FileEntrySeed
