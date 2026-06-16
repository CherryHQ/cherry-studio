import { read } from '@main/utils/file/fs'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

import { stripOkfFrontmatter } from '../utils/sources/okfFrontmatter'
import { getKnowledgeBaseFilePath } from '../utils/storage/pathStorage'

/**
 * Read a note from its captured on-disk snapshot — never the inline content. The
 * indexing job's ensure-snapshot step writes the note's content to a base file
 * (and its `relativePath`) before this runs, so a missing `relativePath` here is
 * a contract violation, not an "index the inline content" fallback.
 *
 * The snapshot is read verbatim minus its OKF frontmatter block — not through
 * the markdown reader, whose lossy transforms would break the file text ->
 * canonical `content.text` round-trip the snapshot exists for: the stored index
 * can then be reconciled against the file by content hash instead of re-embedding
 * (matching the url reader).
 */
export async function loadNoteDocuments(item: KnowledgeItemOf<'note'>): Promise<Document[]> {
  if (!item.data.relativePath) {
    throw new Error(`Knowledge note item ${item.id} has no captured snapshot to read`)
  }

  const filePath = getKnowledgeBaseFilePath(item.baseId, item.data.relativePath)
  const text = stripOkfFrontmatter(await read(filePath))
  const sourceMetadata: KnowledgeSourceMetadata = { source: item.data.source }

  return [new Document({ text, metadata: { ...sourceMetadata } })]
}
