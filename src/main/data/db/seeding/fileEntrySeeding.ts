import { fileEntryTable } from '@data/db/schemas/file'
import { getFilesDir, getNotesDir, getTempFilesDir } from '@main/utils/file'
import type { MountConfig } from '@shared/data/types/file'
import { sql } from 'drizzle-orm'

import type { DbType, ISeed } from '../types'

interface SystemEntry {
  id: string
  type: 'mount'
  name: string
  mountId: string
  parentId: null
  mountConfig: MountConfig
}

function getSystemEntries(): SystemEntry[] {
  let filesDir: string
  let notesDir: string
  let tempDir: string
  try {
    filesDir = getFilesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount_files: ${(err as Error).message}`)
  }
  try {
    notesDir = getNotesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount_notes: ${(err as Error).message}`)
  }
  try {
    tempDir = getTempFilesDir()
  } catch (err) {
    throw new Error(`Failed to resolve base path for mount_temp: ${(err as Error).message}`)
  }

  return [
    {
      id: 'mount_files',
      type: 'mount',
      name: 'Files',
      mountId: 'mount_files',
      parentId: null,
      mountConfig: {
        mountType: 'local_managed',
        basePath: filesDir
      }
    },
    {
      id: 'mount_notes',
      type: 'mount',
      name: 'Notes',
      mountId: 'mount_notes',
      parentId: null,
      mountConfig: {
        mountType: 'local_external',
        basePath: notesDir,
        watch: true,
        watchExtensions: []
      }
    },
    {
      id: 'mount_temp',
      type: 'mount',
      name: 'Temp',
      mountId: 'mount_temp',
      parentId: null,
      mountConfig: {
        mountType: 'local_managed',
        basePath: tempDir
      }
    },
    {
      id: 'system_trash',
      type: 'mount',
      name: 'Trash',
      mountId: 'system_trash',
      parentId: null,
      mountConfig: {
        mountType: 'system'
      }
    }
  ]
}

class FileEntrySeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const systemEntries = getSystemEntries()
    // Upsert: insert new system entries or update mountConfig if paths changed (e.g. after app upgrade)
    await db
      .insert(fileEntryTable)
      .values(systemEntries)
      .onConflictDoUpdate({
        target: fileEntryTable.id,
        set: {
          name: sql`excluded.name`,
          mountConfig: sql`excluded.mount_config`
        }
      })
  }
}

export default FileEntrySeed
