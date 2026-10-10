import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'

export interface KnowledgePageBaseGroupSection {
  groupId: string | null
  items: KnowledgeBaseListItem[]
}

export const DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY = 'knowledge.groups.default'

export const buildKnowledgeBaseGroupSections = (
  bases: ReadonlyArray<KnowledgeBaseListItem>,
  groups: ReadonlyArray<Group>,
  searchValue: string
): KnowledgePageBaseGroupSection[] => {
  const normalizedSearch = searchValue.trim().toLowerCase()
  const includeEmptyKnownGroups = normalizedSearch.length === 0
  const groupedBases = new Map<string | null, KnowledgeBaseListItem[]>()
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

  const sections: KnowledgePageBaseGroupSection[] = []

  const defaultGroupItems = groupedBases.get(null)
  if (defaultGroupItems || includeEmptyKnownGroups) {
    sections.push({ groupId: null, items: defaultGroupItems ?? [] })
  }

  for (const group of groups) {
    const items = groupedBases.get(group.id)
    if (items || includeEmptyKnownGroups) {
      sections.push({ groupId: group.id, items: items ?? [] })
    }
  }

  for (const groupId of unknownGroupIds) {
    const items = groupedBases.get(groupId)
    if (items) {
      sections.push({ groupId, items })
    }
  }

  return sections
}
