import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

export interface KnowledgeV2BaseGroupSection {
  groupId: string | null
  items: KnowledgeBase[]
}

export const buildKnowledgeBaseGroupSections = (
  bases: ReadonlyArray<KnowledgeBase>,
  groups: ReadonlyArray<Group>,
  searchValue: string
): KnowledgeV2BaseGroupSection[] => {
  const normalizedSearch = searchValue.trim().toLowerCase()
  const groupedBases = new Map<string | null, KnowledgeBase[]>()
  const knownGroupIds = new Set(groups.map((group) => group.id))
  const unknownGroupIds: string[] = []

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

    if (groupId != null && !knownGroupIds.has(groupId)) {
      unknownGroupIds.push(groupId)
    }
  }

  const sections: KnowledgeV2BaseGroupSection[] = []

  for (const group of groups) {
    const items = groupedBases.get(group.id)
    if (items) {
      sections.push({ groupId: group.id, items })
    }
  }

  for (const groupId of unknownGroupIds) {
    const items = groupedBases.get(groupId)
    if (items) {
      sections.push({ groupId, items })
    }
  }

  const ungroupedItems = groupedBases.get(null)
  if (ungroupedItems) {
    sections.push({ groupId: null, items: ungroupedItems })
  }

  return sections
}
