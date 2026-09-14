import { lazy, Suspense } from 'react'

import { useKnowledgePage } from '../KnowledgePageProvider'

// Management dialogs are loaded on first open instead of with the page.
const AddKnowledgeItemDialog = lazy(() => import('../components/AddKnowledgeItemDialog'))
const CreateKnowledgeBaseDialog = lazy(() => import('../components/CreateKnowledgeBaseDialog'))
const CreateKnowledgeGroupDialog = lazy(() => import('../components/CreateKnowledgeGroupDialog'))
const KnowledgeBaseNameDialog = lazy(() => import('../components/KnowledgeBaseNameDialog'))
const RenameKnowledgeGroupDialog = lazy(() => import('../components/RenameKnowledgeGroupDialog'))
const RestoreKnowledgeBaseDialog = lazy(() => import('../components/RestoreKnowledgeBaseDialog'))

const KnowledgePageDialogSection = () => {
  const {
    groups,
    editingBase,
    editingGroup,
    restoringBase,
    restoreBaseInitialValues,
    isAddSourceDialogOpen,
    isCreateBaseDialogOpen,
    isCreateGroupDialogOpen,
    createBaseInitialGroupId,
    isCreatingBase,
    isCreatingGroup,
    isUpdatingBase,
    isUpdatingGroup,
    isRestoringBase,
    createBase,
    restoreBase,
    handleAddSourceDialogOpenChange,
    handleCreateBaseCreated,
    handleCreateBaseDialogOpenChange,
    handleCreateGroupDialogOpenChange,
    handleRenameBaseDialogOpenChange,
    handleRenameGroupDialogOpenChange,
    handleRestoreBaseDialogOpenChange,
    handleRestoreBaseRestored,
    submitCreateGroup,
    submitRenameBase,
    submitRenameGroup
  } = useKnowledgePage()

  return (
    <Suspense fallback={null}>
      {isAddSourceDialogOpen ? (
        <AddKnowledgeItemDialog open={isAddSourceDialogOpen} onOpenChange={handleAddSourceDialogOpenChange} />
      ) : null}

      {isCreateGroupDialogOpen ? (
        <CreateKnowledgeGroupDialog
          open={isCreateGroupDialogOpen}
          isSubmitting={isCreatingGroup}
          onSubmit={submitCreateGroup}
          onOpenChange={handleCreateGroupDialogOpenChange}
        />
      ) : null}

      {editingGroup ? (
        <RenameKnowledgeGroupDialog
          open
          initialName={editingGroup.name}
          isSubmitting={isUpdatingGroup}
          onSubmit={submitRenameGroup}
          onOpenChange={handleRenameGroupDialogOpenChange}
        />
      ) : null}

      {editingBase ? (
        <KnowledgeBaseNameDialog
          open
          initialName={editingBase.name}
          isSubmitting={isUpdatingBase}
          onSubmit={submitRenameBase}
          onOpenChange={handleRenameBaseDialogOpenChange}
        />
      ) : null}

      {restoringBase ? (
        <RestoreKnowledgeBaseDialog
          open
          base={restoringBase}
          initialEmbeddingModelId={restoreBaseInitialValues?.embeddingModelId}
          isRestoring={isRestoringBase}
          restoreBase={restoreBase}
          onOpenChange={handleRestoreBaseDialogOpenChange}
          onRestored={handleRestoreBaseRestored}
        />
      ) : null}

      {isCreateBaseDialogOpen ? (
        <CreateKnowledgeBaseDialog
          open={isCreateBaseDialogOpen}
          groups={groups}
          initialGroupId={createBaseInitialGroupId}
          isCreating={isCreatingBase}
          createBase={createBase}
          onOpenChange={handleCreateBaseDialogOpenChange}
          onCreated={handleCreateBaseCreated}
        />
      ) : null}
    </Suspense>
  )
}

export default KnowledgePageDialogSection
