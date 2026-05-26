import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'

export type KnowledgeSourcePlan =
  | { kind: 'prepare-root' }
  | { kind: 'index-documents' }
  | { kind: 'invalid'; reason: string }

export function planKnowledgeItemSource(item: KnowledgeItem): KnowledgeSourcePlan {
  if (isContainerKnowledgeItem(item)) {
    return { kind: 'prepare-root' }
  }

  if (isIndexableKnowledgeItem(item)) {
    return { kind: 'index-documents' }
  }

  return { kind: 'invalid', reason: 'Unsupported knowledge item type' }
}
