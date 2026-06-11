import type { KnowledgePageBaseGroupSection } from '@renderer/pages/knowledge/utils'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

export interface MenuPosition {
  x: number
  y: number
}

export interface BaseNavigatorSearchProps {
  value: string
  onValueChange: (value: string) => void
}

export interface BaseNavigatorContentProps {
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
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

export interface BaseNavigatorGroupSectionProps {
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
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

export interface BaseNavigatorSectionTriggerProps {
  label: string
  itemCount: number
  leadingSlot?: ReactNode
  actionSlot?: ReactNode
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export interface BaseNavigatorCreateMenuProps {
  onCreateBase: () => void
  onCreateGroup: () => void
}

export interface BaseNavigatorResizeHandleProps {
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export interface NavigatorRowMenuProps {
  open: boolean
  menuPosition: MenuPosition | null
  trigger: ReactNode
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export interface KnowledgeBaseRowProps {
  base: KnowledgeBaseListItem
  groups: Group[]
  selected: boolean
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

export interface KnowledgeBaseRowMenuProps {
  open: boolean
  menuPosition: MenuPosition | null
  trigger: ReactNode
  onOpenChange: (open: boolean) => void
  availableGroups: Group[]
  onRename: () => void
  canMoveToUngrouped: boolean
  onMove: (groupId: string | null) => Promise<void> | void
  onRequestDelete: () => void
}

export interface KnowledgeGroupRowProps {
  group: Group
  itemCount: number
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onCreateBase: (groupId: string) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
}

export interface KnowledgeGroupRowMenuProps {
  open: boolean
  menuPosition: MenuPosition | null
  trigger: ReactNode
  onOpenChange: (open: boolean) => void
  onRename: () => void
  onCreateBase: () => void
  onRequestDelete: () => void
}

export const UNGROUPED_SECTION_VALUE = 'ungrouped'
