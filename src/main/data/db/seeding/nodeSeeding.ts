import { nodeTable } from '@data/db/schemas/node'
import { getFilesDir, getNotesDir } from '@main/utils/file'
import type { MountProviderConfig } from '@shared/data/types/file'
import { sql } from 'drizzle-orm'

import type { DbType, ISeed } from '../types'

interface SystemNode {
  id: string
  type: 'mount'
  name: string
  mountId: string
  parentId: null
  providerConfig: MountProviderConfig
}

function getSystemNodes(): SystemNode[] {
  return [
    {
      id: 'mount_files',
      type: 'mount',
      name: 'Files',
      mountId: 'mount_files',
      parentId: null,
      providerConfig: {
        providerType: 'local_managed',
        basePath: getFilesDir()
      }
    },
    {
      id: 'mount_notes',
      type: 'mount',
      name: 'Notes',
      mountId: 'mount_notes',
      parentId: null,
      providerConfig: {
        providerType: 'local_external',
        basePath: getNotesDir(),
        watch: true
      }
    },
    {
      id: 'system_trash',
      type: 'mount',
      name: 'Trash',
      mountId: 'system_trash',
      parentId: null,
      providerConfig: {
        providerType: 'system'
      }
    }
  ]
}

class NodeSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const systemNodes = getSystemNodes()
    // Upsert: insert new system nodes or update providerConfig if paths changed (e.g. after app upgrade)
    await db
      .insert(nodeTable)
      .values(systemNodes)
      .onConflictDoUpdate({
        target: nodeTable.id,
        set: {
          name: sql`excluded.name`,
          providerConfig: sql`excluded.provider_config`
        }
      })
  }
}

export default NodeSeed
