import type { KnowledgeBase } from '@shared/data/types/knowledge'

export interface KnowledgeV2BaseGroupSection {
  groupId: string | null
  items: KnowledgeBase[]
}

export const buildKnowledgeV2BaseGroupSections = (
  bases: ReadonlyArray<KnowledgeBase>,
  searchValue: string
): KnowledgeV2BaseGroupSection[] => {
  const normalizedSearch = searchValue.trim().toLowerCase()
  const groupedBases = new Map<string | null, KnowledgeBase[]>()

  for (const base of bases) {
    if (normalizedSearch && !base.name.toLowerCase().includes(normalizedSearch)) {
      continue
    }

    const groupId = base.groupId ?? null
    const groupItems = groupedBases.get(groupId)

    if (groupItems) {
      groupItems.push(base)
      continue
    }

    groupedBases.set(groupId, [base])
  }

  return Array.from(groupedBases, ([groupId, items]) => ({ groupId, items }))
}
