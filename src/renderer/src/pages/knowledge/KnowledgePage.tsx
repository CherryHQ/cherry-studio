import { useShortcut } from '@renderer/hooks/useShortcuts'
import type { FC } from 'react'
import { useState } from 'react'

import AddKnowledgeBaseDialog from './components/AddKnowledgeBaseDialog'
import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './components/KnowledgeSearchDialog'
import KnowledgeSideNav from './components/KnowledgeSideNav'
import { useKnowledgeBaseSelection } from './hooks/useKnowledgeBaseSelection'
import KnowledgeContent from './KnowledgeContent'

const KnowledgePage: FC = () => {
  const {
    bases,
    selectedBaseId,
    selectBase,
    handleAddKnowledgeBase,
    deleteKnowledgeBase,
    // Dialog states and handlers
    addDialogOpen,
    setAddDialogOpen,
    editDialogOpen,
    editingBaseId,
    handleAddSuccess,
    handleEditSuccess,
    handleEditDialogClose
  } = useKnowledgeBaseSelection()

  // Search dialog state
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  useShortcut('search_message', () => {
    if (selectedBaseId) {
      setSearchDialogOpen(true)
    }
  })

  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] flex-1 flex-col">
      <div className="flex min-h-full flex-1 flex-row">
        <KnowledgeSideNav
          bases={bases}
          selectedBaseId={selectedBaseId}
          onSelect={selectBase}
          onAdd={handleAddKnowledgeBase}
          deleteKnowledgeBase={deleteKnowledgeBase}
        />
        {bases.length === 0 && <div className="flex w-full" />}
        {selectedBaseId && <KnowledgeContent selectedBaseId={selectedBaseId} />}
      </div>

      {/* Dialogs */}
      <AddKnowledgeBaseDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSuccess={handleAddSuccess} />
      {editingBaseId && (
        <EditKnowledgeBaseDialog
          baseId={editingBaseId}
          open={editDialogOpen}
          onOpenChange={handleEditDialogClose}
          onSuccess={handleEditSuccess}
        />
      )}
      {selectedBaseId && (
        <KnowledgeSearchDialog baseId={selectedBaseId} open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
      )}
    </div>
  )
}

export default KnowledgePage
