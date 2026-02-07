import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledgeData'
import { useCallback, useEffect, useState } from 'react'

export const useKnowledgeBaseSelection = () => {
  const { bases, deleteKnowledgeBase } = useKnowledgeBases()
  const [selectedBaseId, setSelectedBaseId] = useState<string | undefined>(bases[0]?.id)

  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const selectBase = useCallback((baseId?: string) => {
    setSelectedBaseId(baseId)
  }, [])

  const handleAddKnowledgeBase = useCallback(() => {
    setAddDialogOpen(true)
  }, [])

  const handleAddSuccess = useCallback(
    (baseId: string) => {
      selectBase(baseId)
      setAddDialogOpen(false)
    },
    [selectBase]
  )

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
    deleteKnowledgeBase,
    addDialogOpen,
    setAddDialogOpen,
    handleAddSuccess
  }
}
