import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledges'
import { useCallback, useEffect, useState } from 'react'

export const useKnowledgeBaseSelection = () => {
  const { bases, renameKnowledgeBase, deleteKnowledgeBase } = useKnowledgeBases()
  const [selectedBaseId, setSelectedBaseId] = useState<string | undefined>(bases[0]?.id)

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null)

  const selectBase = useCallback((baseId?: string) => {
    setSelectedBaseId(baseId)
  }, [])

  const handleAddKnowledgeBase = useCallback(() => {
    setAddDialogOpen(true)
  }, [])

  const handleEditKnowledgeBase = useCallback((baseId: string) => {
    setEditingBaseId(baseId)
    setEditDialogOpen(true)
  }, [])

  const handleAddSuccess = useCallback(
    (baseId: string) => {
      selectBase(baseId)
      setAddDialogOpen(false)
    },
    [selectBase]
  )

  const handleEditSuccess = useCallback(
    (baseId: string) => {
      selectBase(baseId)
      setEditDialogOpen(false)
      setEditingBaseId(null)
    },
    [selectBase]
  )

  const handleEditDialogClose = useCallback((open: boolean) => {
    setEditDialogOpen(open)
    if (!open) {
      setEditingBaseId(null)
    }
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

  return {
    bases,
    selectedBaseId,
    selectBase,
    handleAddKnowledgeBase,
    handleEditKnowledgeBase,
    renameKnowledgeBase,
    deleteKnowledgeBase,
    // Dialog states and handlers
    addDialogOpen,
    setAddDialogOpen,
    editDialogOpen,
    editingBaseId,
    handleAddSuccess,
    handleEditSuccess,
    handleEditDialogClose
  }
}
