import { nodeTable } from '@data/db/schemas/node'
import { getFilesDir, getNotesDir } from '@main/utils/file'
import type { MountProviderConfig } from '@shared/data/types/fileProvider'
import { inArray } from 'drizzle-orm'

import type { DbType, ISeed } from '../types'

interface SystemNode {
  id: string
  type: 'mount'
  name: string
  mountId: string
  parentId: null
  providerConfig: MountProviderConfig
}

const SYSTEM_NODES: SystemNode[] = [
  {
    id: 'mount_files',
    type: 'mount',
    name: 'Files',
    mountId: 'mount_files',
    parentId: null,
    providerConfig: {
      provider_type: 'local_managed',
      base_path: getFilesDir()
    }
  },
  {
    id: 'mount_notes',
    type: 'mount',
    name: 'Notes',
    mountId: 'mount_notes',
    parentId: null,
    providerConfig: {
      provider_type: 'local_external',
      base_path: getNotesDir(),
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
      provider_type: 'system'
    }
  }
]

class NodeSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const systemIds = SYSTEM_NODES.map((n) => n.id)

    const existing = await db.select({ id: nodeTable.id }).from(nodeTable).where(inArray(nodeTable.id, systemIds))

    const existingIds = new Set(existing.map((r) => r.id))
    const toInsert = SYSTEM_NODES.filter((n) => !existingIds.has(n.id))

    if (toInsert.length > 0) {
      await db.insert(nodeTable).values(toInsert)
    }
  }
}

export default NodeSeed
