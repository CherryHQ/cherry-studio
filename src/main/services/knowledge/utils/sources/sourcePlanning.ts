import { getFileExt } from '@main/utils/file'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'

const FILE_PROCESSING_DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx'])

export type KnowledgeSourcePlan =
  | { kind: 'prepare-root' }
  | { kind: 'index-documents' }
  | { kind: 'needsFileProcessing' }
  | { kind: 'invalid'; reason: string }

export function planKnowledgeItemSource(base: KnowledgeBase, item: KnowledgeItem): KnowledgeSourcePlan {
  if (isContainerKnowledgeItem(item)) {
    return { kind: 'prepare-root' }
  }

  if (needsFileProcessing(base, item)) {
    return { kind: 'needsFileProcessing' }
  }

  if (isIndexableKnowledgeItem(item)) {
    return { kind: 'index-documents' }
  }

  return { kind: 'invalid', reason: 'Unsupported knowledge item type' }
}

function needsFileProcessing(base: KnowledgeBase, item: KnowledgeItem): boolean {
  if (item.type !== 'file' || !base.fileProcessorId) {
    return false
  }

  const ext = getFileExt(item.data.source).replace(/^\./, '').toLowerCase()
  return FILE_PROCESSING_DOCUMENT_EXTS.has(ext)
}
