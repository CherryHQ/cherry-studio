import type { ComponentProps, MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import type { KnowledgePageBaseGroupSection } from '@renderer/pages/knowledge/utils/group'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { ReorderKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

export interface BaseNavigatorContentProps {
  onReorderBase?: (id: string, request: ReorderKnowledgeBaseDto) => Promise<void>
  onReorderGroup?: (id: string, anchor: OrderRequest) => Promise<void>
  isReordering?: boolean
  isLoading: boolean
  sections: KnowledgePageBaseGroupSection[]
  groups: Group[]
  groupById: ReadonlyMap<string, Group>
  selectedBaseId: string
  getGroupLabel: (groupId: string | null) => string
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onCreateBaseInGroup: (groupId: string) => void
  onCreateGroup: (baseId: string) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

export interface BaseNavigatorGroupSectionProps {
  dragDisabled?: boolean
  indicator?: { id: string; position: 'before' | 'after' } | null
  section: KnowledgePageBaseGroupSection
  group?: Group
  groupLabel: string
  groups: Group[]
  selectedBaseId: string
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onCreateBaseInGroup: (groupId: string) => void
  onCreateGroup: (baseId: string) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
  onToggleSidebar: (base: KnowledgeBaseListItem) => void
  sidebarPinnedBaseIds: ReadonlySet<string>
}

export interface BaseNavigatorSectionTriggerProps {
  dragProps?: ComponentProps<'button'>
  label: string
  leadingSlot?: ReactNode
  actionSlot?: ReactNode
}

export interface BaseNavigatorResizeHandleProps {
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export interface KnowledgeBaseRowProps {
  dragProps?: ComponentProps<'button'>
  base: KnowledgeBaseListItem
  groups: Group[]
  selected: boolean
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onCreateGroup: (baseId: string) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
  onToggleSidebar: (base: KnowledgeBaseListItem) => void
  sidebarPinned: boolean
}

export interface KnowledgeGroupRowProps {
  dragProps?: ComponentProps<'button'>
  group: Group
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onCreateBase: (groupId: string) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
}

export const UNGROUPED_SECTION_VALUE = 'ungrouped'
