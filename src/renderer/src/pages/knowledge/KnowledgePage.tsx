import { type FC, useMemo } from 'react'

import AddKnowledgeBaseDialog from './components/AddKnowledgeBaseDialog'
import EditKnowledgeBaseDialog from './components/EditKnowledgeBaseDialog'
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

  const editingBase = useMemo(() => bases.find((b) => b.id === editingBaseId), [bases, editingBaseId])

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
      {editingBase && (
        <EditKnowledgeBaseDialog
          base={editingBase}
          open={editDialogOpen}
          onOpenChange={handleEditDialogClose}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  )
}

export default KnowledgePage
