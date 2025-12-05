import type { UseInPlaceEditReturn } from '@renderer/hooks/useInPlaceEdit'
import type { NotesTreeNode } from '@renderer/types/note'
import type { MenuProps } from 'antd'
import { createContext, use } from 'react'

// ==================== 1. Actions Context (Static, rarely changes) ====================
export interface NotesActionsContextType {
  getMenuItems: (node: NotesTreeNode) => MenuProps['items']
  onSelectNode: (node: NotesTreeNode) => void
  onToggleExpanded: (nodeId: string) => void
  onDropdownOpenChange: (key: string | null) => void
}

export const NotesActionsContext = createContext<NotesActionsContextType | null>(null)

export const useNotesActions = () => {
  const context = use(NotesActionsContext)
  if (!context) {
    throw new Error('useNotesActions must be used within NotesActionsContext.Provider')
  }
  return context
}

// ==================== 2. Selection Context (Low frequency updates) ====================
export interface NotesSelectionContextType {
  selectedFolderId?: string | null
  activeNodeId?: string
}

export const NotesSelectionContext = createContext<NotesSelectionContextType | null>(null)

export const useNotesSelection = () => {
  const context = use(NotesSelectionContext)
  if (!context) {
    throw new Error('useNotesSelection must be used within NotesSelectionContext.Provider')
  }
  return context
}

// ==================== 3. Editing Context (Medium frequency updates) ====================
export interface NotesEditingContextType {
  editingNodeId: string | null
  renamingNodeIds: Set<string>
  newlyRenamedNodeIds: Set<string>
  inPlaceEdit: UseInPlaceEditReturn
}

export const NotesEditingContext = createContext<NotesEditingContextType | null>(null)

export const useNotesEditing = () => {
  const context = use(NotesEditingContext)
  if (!context) {
    throw new Error('useNotesEditing must be used within NotesEditingContext.Provider')
  }
  return context
}

// ==================== 4. Drag Context (High frequency updates) ====================
export interface NotesDragContextType {
  draggedNodeId: string | null
  dragOverNodeId: string | null
  dragPosition: 'before' | 'inside' | 'after'
  onDragStart: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragOver: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, node: NotesTreeNode) => void
  onDragEnd: () => void
}

export const NotesDragContext = createContext<NotesDragContextType | null>(null)

export const useNotesDrag = () => {
  const context = use(NotesDragContext)
  if (!context) {
    throw new Error('useNotesDrag must be used within NotesDragContext.Provider')
  }
  return context
}

// ==================== 5. Search Context (Medium frequency updates) ====================
export interface NotesSearchContextType {
  searchKeyword: string
  showMatches: boolean
}

export const NotesSearchContext = createContext<NotesSearchContextType | null>(null)

export const useNotesSearch = () => {
  const context = use(NotesSearchContext)
  if (!context) {
    throw new Error('useNotesSearch must be used within NotesSearchContext.Provider')
  }
  return context
}

// ==================== 6. UI Context (Medium frequency updates) ====================
export interface NotesUIContextType {
  openDropdownKey: string | null
}

export const NotesUIContext = createContext<NotesUIContextType | null>(null)

export const useNotesUI = () => {
  const context = use(NotesUIContext)
  if (!context) {
    throw new Error('useNotesUI must be used within NotesUIContext.Provider')
  }
  return context
}
