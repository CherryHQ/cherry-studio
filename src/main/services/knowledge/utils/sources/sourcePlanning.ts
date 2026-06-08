import { getFileExt } from '@main/utils/file'
import { documentExts } from '@shared/config/constant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'

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

  const ext = getFileExt(item.data.relativePath).toLowerCase()
  return documentExts.includes(ext)
}
