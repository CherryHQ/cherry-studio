import type { KnowledgePageBaseGroupSection } from '@renderer/pages/knowledge.v2/utils'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

export interface MenuPosition {
  x: number
  y: number
}

export interface BaseNavigatorHeaderProps {
  baseCount: number
  onCreateGroup: () => void
  onCreateBase: () => void
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
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
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
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
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

export interface BaseNavigatorFooterProps {
  onCreateBase: () => void
}

export interface BaseNavigatorResizeHandleProps {
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export interface NavigatorMoreButtonProps {
  visible: boolean
  className?: string
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

export interface NavigatorRowMenuProps {
  menuPosition: MenuPosition | null
  onClose: () => void
  children: ReactNode
}

export interface KnowledgeBaseRowProps {
  base: KnowledgeBase
  groups: Group[]
  selected: boolean
  onSelectBase: (baseId: string) => void
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onDeleteBase: (baseId: string) => Promise<void> | void
}

export interface KnowledgeBaseRowMenuProps {
  menuPosition: MenuPosition | null
  availableGroups: Group[]
  onClose: () => void
  onRename: () => void
  onMove: (groupId: string) => Promise<void> | void
  onRequestDelete: () => void
}

export interface KnowledgeGroupRowProps {
  group: Group
  itemCount: number
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
}

export interface KnowledgeGroupRowMenuProps {
  menuPosition: MenuPosition | null
  onClose: () => void
  onRename: () => void
  onRequestDelete: () => void
}

export const DEFAULT_DOCUMENT_COUNT = 0
export const UNGROUPED_SECTION_VALUE = 'ungrouped'
