import { useKnowledgeBase, useKnowledgeBases, useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TabKey } from '../constants/tabs'
import { useKnowledgeQueueActions } from '../hooks/useKnowledgeQueueActions'
import { groupKnowledgeItemsByType } from '../utils/knowledgeItems'
import {
  KnowledgeBaseContext,
  type KnowledgeBaseContextType,
  KnowledgeItemsContext,
  type KnowledgeItemsContextType,
  KnowledgeQueueContext,
  type KnowledgeQueueContextType,
  KnowledgeUIContext,
  type KnowledgeUIContextType
} from './KnowledgeContexts'

interface KnowledgeProviderProps {
  children: ReactNode
}

export const KnowledgeProvider: FC<KnowledgeProviderProps> = ({ children }) => {
  // ── Base selection state (absorbed from useKnowledgeBaseSelection) ──
  const { bases, deleteKnowledgeBase, isLoading: isBasesLoading } = useKnowledgeBases()
  const [selectedBaseId, setSelectedBaseId] = useState<string | undefined>(bases[0]?.id)

  const selectBase = useCallback((baseId?: string) => {
    setSelectedBaseId(baseId)
  }, [])

  useEffect(() => {
    if (bases.length === 0) {
      setSelectedBaseId(undefined)
      return
    }
    const hasSelectedBase = bases.some((base) => base.id === selectedBaseId)
    if (!hasSelectedBase) {
      setSelectedBaseId(bases[0]?.id)
    }
  }, [bases, selectedBaseId])

  // ── Resolved base & items ──
  const { base: selectedBase } = useKnowledgeBase(selectedBaseId ?? '')
  const { items, treeItems } = useKnowledgeItems(selectedBaseId ?? '')

  // ── Queue actions ──
  const { hasOrphans, orphanCount, handleRecover, handleIgnore, isRecovering, isIgnoring } = useKnowledgeQueueActions(
    selectedBaseId ?? ''
  )

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<TabKey>('files')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  // ── Memoized context values ──
  const baseCtx = useMemo<KnowledgeBaseContextType>(
    () => ({
      bases,
      selectedBaseId,
      selectedBase,
      isLoading: isBasesLoading,
      selectBase,
      deleteBase: deleteKnowledgeBase
    }),
    [bases, selectedBaseId, selectedBase, isBasesLoading, selectBase, deleteKnowledgeBase]
  )

  const itemsByType = useMemo(() => groupKnowledgeItemsByType(items), [items])

  const itemsCtx = useMemo<KnowledgeItemsContextType>(
    () => ({
      items,
      treeItems,
      itemsByType
    }),
    [items, treeItems, itemsByType]
  )

  const uiCtx = useMemo<KnowledgeUIContextType>(
    () => ({
      activeTab,
      addDialogOpen,
      editDialogOpen,
      searchDialogOpen,
      setActiveTab,
      openAddDialog: () => setAddDialogOpen(true),
      closeAddDialog: () => setAddDialogOpen(false),
      openEditDialog: () => setEditDialogOpen(true),
      closeEditDialog: () => setEditDialogOpen(false),
      openSearchDialog: () => setSearchDialogOpen(true),
      closeSearchDialog: () => setSearchDialogOpen(false)
    }),
    [activeTab, addDialogOpen, editDialogOpen, searchDialogOpen]
  )

  const queueCtx = useMemo<KnowledgeQueueContextType>(
    () => ({
      hasOrphans,
      orphanCount,
      isRecovering,
      isIgnoring,
      handleRecover,
      handleIgnore
    }),
    [hasOrphans, orphanCount, isRecovering, isIgnoring, handleRecover, handleIgnore]
  )

  return (
    <KnowledgeBaseContext value={baseCtx}>
      <KnowledgeItemsContext value={itemsCtx}>
        <KnowledgeUIContext value={uiCtx}>
          <KnowledgeQueueContext value={queueCtx}>{children}</KnowledgeQueueContext>
        </KnowledgeUIContext>
      </KnowledgeItemsContext>
    </KnowledgeBaseContext>
  )
}
