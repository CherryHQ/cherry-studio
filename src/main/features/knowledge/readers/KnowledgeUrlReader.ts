import { read } from '@main/utils/file/fs'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument } from '@vectorstores/core'

import { stripOkfFrontmatter } from '../utils/sources/okfFrontmatter'
import { getKnowledgeBaseFilePath } from '../utils/storage/pathStorage'

/**
 * Read a URL item from its captured on-disk snapshot — never the network. The
 * indexing job's ensure-snapshot step fetches and persists the snapshot (and
 * its `relativePath`) before this runs, so a missing `relativePath` here is a
 * contract violation, not a "fetch it now" fallback.
 *
 * The snapshot is read verbatim minus its OKF frontmatter block — not through
 * the markdown reader, whose lossy transforms (header re-splitting,
 * hyperlink/image removal) would break the round-trip the snapshot exists for:
 * file text → canonical `content.text` must be exact, so the stored index can
 * be reconciled against the file by content hash instead of re-embedding.
 */
export async function loadUrlDocuments(item: KnowledgeItemOf<'url'>): Promise<VectorStoreDocument[]> {
  if (!item.data.relativePath) {
    throw new Error(`Knowledge URL item ${item.id} has no captured snapshot to read`)
  }

  const filePath = getKnowledgeBaseFilePath(item.baseId, item.data.relativePath)
  const text = stripOkfFrontmatter(await read(filePath))
  const sourceMetadata: KnowledgeSourceMetadata = { source: item.data.source }

  return [new Document({ text, metadata: { ...sourceMetadata } })]
}
