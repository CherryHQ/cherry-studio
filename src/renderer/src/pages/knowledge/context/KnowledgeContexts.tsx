import type { KnowledgeBase, KnowledgeItem, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import { createContext, use } from 'react'

import type { TabKey } from '../constants/tabs'
import type { KnowledgeItemsByType } from '../utils/knowledgeItems'

// ==================== 1. KnowledgeBase Context (Low frequency — base selection changes) ====================
export interface KnowledgeBaseContextType {
  bases: KnowledgeBase[]
  selectedBaseId: string | undefined
  selectedBase: KnowledgeBase | undefined
  isLoading: boolean
  selectBase: (baseId?: string) => void
  deleteBase: (baseId: string) => Promise<void>
}

export const KnowledgeBaseContext = createContext<KnowledgeBaseContextType | null>(null)

export const useKnowledgeBaseCtx = () => {
  const context = use(KnowledgeBaseContext)
  if (!context) {
    throw new Error('useKnowledgeBaseCtx must be used within KnowledgeProvider')
  }
  return context
}

// ==================== 2. KnowledgeItems Context (Medium frequency — items poll during processing) ====================
export interface KnowledgeItemsContextType {
  items: KnowledgeItem[]
  treeItems: KnowledgeItemTreeNode[]
  itemsByType: KnowledgeItemsByType
}

export const KnowledgeItemsContext = createContext<KnowledgeItemsContextType | null>(null)

export const useKnowledgeItemsCtx = () => {
  const context = use(KnowledgeItemsContext)
  if (!context) {
    throw new Error('useKnowledgeItemsCtx must be used within KnowledgeProvider')
  }
  return context
}

// ==================== 3. KnowledgeUI Context (Medium frequency — tab/dialog UI state) ====================
export interface KnowledgeUIContextType {
  activeTab: TabKey
  addDialogOpen: boolean
  editDialogOpen: boolean
  searchDialogOpen: boolean
  setActiveTab: (tab: TabKey) => void
  openAddDialog: () => void
  closeAddDialog: () => void
  openEditDialog: () => void
  closeEditDialog: () => void
  openSearchDialog: () => void
  closeSearchDialog: () => void
}

export const KnowledgeUIContext = createContext<KnowledgeUIContextType | null>(null)

export const useKnowledgeUICtx = () => {
  const context = use(KnowledgeUIContext)
  if (!context) {
    throw new Error('useKnowledgeUICtx must be used within KnowledgeProvider')
  }
  return context
}

// ==================== 4. KnowledgeQueue Context (Low frequency — orphan recovery) ====================
export interface KnowledgeQueueContextType {
  hasOrphans: boolean
  orphanCount: number
  isRecovering: boolean
  isIgnoring: boolean
  handleRecover: () => Promise<void>
  handleIgnore: () => Promise<void>
}

export const KnowledgeQueueContext = createContext<KnowledgeQueueContextType | null>(null)

export const useKnowledgeQueueCtx = () => {
  const context = use(KnowledgeQueueContext)
  if (!context) {
    throw new Error('useKnowledgeQueueCtx must be used within KnowledgeProvider')
  }
  return context
}
