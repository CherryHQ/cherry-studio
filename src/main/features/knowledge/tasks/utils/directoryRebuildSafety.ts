import path from 'node:path'

import type { KnowledgeItem } from '@shared/data/types/knowledge'

/** Filesystem scans cannot recreate independently added documents. Never purge them as expansion. */
export function assertDirectoryRebuildSafe(root: KnowledgeItem, descendants: KnowledgeItem[]): void {
  if (root.type !== 'directory') return
  const sourceRoot = path.resolve(root.data.source)
  const independent = descendants.find((item) => {
    if (item.id === root.id) return false
    if (item.type !== 'file' && item.type !== 'directory') return true
    const relative = path.relative(sourceRoot, path.resolve(item.data.source))
    return relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  })
  if (independent) {
    throw new Error(
      `Cannot rebuild folder "${root.id}" while it contains independently added documents. ` +
        'Move those documents to the knowledge base root before reindexing. No documents were removed.'
    )
  }
}
