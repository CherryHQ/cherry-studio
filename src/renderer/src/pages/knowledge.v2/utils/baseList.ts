import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeV2BaseListItem, KnowledgeV2BaseListStatus } from '../types'

export interface KnowledgeV2BaseGroupSection {
  groupId: string | null
  items: KnowledgeV2BaseListItem[]
}

export interface KnowledgeV2BaseListPatch {
  itemCount?: number
  status?: KnowledgeV2BaseListStatus
}

export const buildKnowledgeV2BaseListItems = (
  bases: ReadonlyArray<KnowledgeBase>,
  patchesByBaseId: Readonly<Partial<Record<string, KnowledgeV2BaseListPatch>>> = {}
): KnowledgeV2BaseListItem[] => {
  return bases.map((base) => {
    const patch = patchesByBaseId[base.id]

    return {
      base,
      itemCount: patch?.itemCount ?? 0,
      status: patch?.status ?? 'completed'
    }
  })
}

export const filterKnowledgeV2BaseGroupSections = (
  bases: ReadonlyArray<KnowledgeV2BaseListItem>,
  searchValue: string
): KnowledgeV2BaseGroupSection[] => {
  const normalizedSearch = searchValue.trim().toLowerCase()
  const groupedBases = new Map<string | null, KnowledgeV2BaseListItem[]>()

  for (const entry of bases) {
    if (normalizedSearch && !entry.base.name.toLowerCase().includes(normalizedSearch)) {
      continue
    }

    const groupId = entry.base.groupId ?? null
    const groupItems = groupedBases.get(groupId)

    if (groupItems) {
      groupItems.push(entry)
      continue
    }

    groupedBases.set(groupId, [entry])
  }

  return Array.from(groupedBases, ([groupId, items]) => ({ groupId, items }))
}
