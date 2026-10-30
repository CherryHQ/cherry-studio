import { Document } from '@vectorstores/core'

import { read } from '@main/utils/file'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'

import { getKnowledgeBaseFilePath } from '../../pathStorage'
import { stripOkfFrontmatter } from '../sources/okfFrontmatter'

/**
 * Read a url, note, or external item from its captured on-disk snapshot — never
 * the network or inline content. The indexing job's ensure-snapshot step
 * fetches/writes the snapshot (and its `relativePath`) before this runs, so a
 * missing `relativePath` here is a contract violation, not a "capture it now"
 * fallback.
 *
 * URL and note snapshots discard Cherry-owned OKF frontmatter. External
 * snapshots are provider-normalized Markdown and remain character-for-character
 * intact as decoded UTF-8 text.
 *
 * `kind` only labels the contract-violation error.
 */
export async function loadSnapshotDocuments(
  item: KnowledgeItemOf<'url'> | KnowledgeItemOf<'note'> | KnowledgeItemOf<'external'>,
  kind: 'URL' | 'note' | 'external'
): Promise<Document[]> {
  if (!item.data.relativePath) {
    throw new Error(`Knowledge ${kind} item ${item.id} has no captured snapshot to read`)
  }

  const filePath = getKnowledgeBaseFilePath(item.baseId, item.data.relativePath)
  const snapshot = await read(filePath)
  const text = item.type === 'external' ? snapshot : stripOkfFrontmatter(snapshot)
  const sourceMetadata: KnowledgeSourceMetadata = { source: item.data.source }

  return [new Document({ text, metadata: { ...sourceMetadata } })]
}
