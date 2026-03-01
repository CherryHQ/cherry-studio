import type { FC } from 'react'

import { useKnowledgeBaseCtx, useKnowledgeUICtx } from '../context'
import AddKnowledgeBaseDialog from './AddKnowledgeBaseDialog'
import EditKnowledgeBaseDialog from './EditKnowledgeBaseDialog'
import KnowledgeSearchDialog from './KnowledgeSearchDialog'

const KnowledgeDialogs: FC = () => {
  const { selectedBase, selectBase } = useKnowledgeBaseCtx()
  const { addDialogOpen, closeAddDialog, editDialogOpen, closeEditDialog, searchDialogOpen, closeSearchDialog } =
    useKnowledgeUICtx()

  const handleAddSuccess = (baseId: string) => {
    selectBase(baseId)
    closeAddDialog()
  }

  return (
    <>
      <AddKnowledgeBaseDialog
        open={addDialogOpen}
        onOpenChange={(open) => !open && closeAddDialog()}
        onSuccess={handleAddSuccess}
      />
      {selectedBase && (
        <>
          <EditKnowledgeBaseDialog
            base={selectedBase}
            open={editDialogOpen}
            onOpenChange={(open) => !open && closeEditDialog()}
          />
          <KnowledgeSearchDialog
            base={selectedBase}
            open={searchDialogOpen}
            onOpenChange={(open) => !open && closeSearchDialog()}
          />
        </>
      )}
    </>
  )
}

export default KnowledgeDialogs
