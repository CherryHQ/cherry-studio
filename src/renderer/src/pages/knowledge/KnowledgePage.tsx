import { type FC } from 'react'

import AddKnowledgeBaseDialog from './components/AddKnowledgeBaseDialog'
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
    // Add dialog state and handlers
    addDialogOpen,
    setAddDialogOpen,
    handleAddSuccess
  } = useKnowledgeBaseSelection()

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
        {selectedBaseId && <KnowledgeContent selectedBaseId={selectedBaseId} />}
      </div>

      {/* Dialogs */}
      <AddKnowledgeBaseDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} onSuccess={handleAddSuccess} />
    </div>
  )
}

export default KnowledgePage
