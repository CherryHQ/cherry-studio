import { lazy, Suspense } from 'react'

import { useExitPresence } from '@renderer/hooks/useExitPresence'

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

  const addSource = useExitPresence(isAddSourceDialogOpen ? true : null)
  const createBaseDialog = useExitPresence(isCreateBaseDialogOpen ? true : null)
  const createGroupDialog = useExitPresence(isCreateGroupDialogOpen ? true : null)
  const renameGroup = useExitPresence(editingGroup)
  const renameBase = useExitPresence(editingBase)
  const restoreBaseDialog = useExitPresence(restoringBase)

  return (
    <Suspense fallback={null}>
      {addSource.isPresent ? (
        <AddKnowledgeItemDialog open={isAddSourceDialogOpen} onOpenChange={handleAddSourceDialogOpenChange} />
      ) : null}

      {createGroupDialog.isPresent ? (
        <CreateKnowledgeGroupDialog
          open={isCreateGroupDialogOpen}
          isSubmitting={isCreatingGroup}
          onSubmit={submitCreateGroup}
          onOpenChange={handleCreateGroupDialogOpenChange}
        />
      ) : null}

      {renameGroup.value ? (
        <RenameKnowledgeGroupDialog
          open={editingGroup !== null}
          initialName={renameGroup.value.name}
          isSubmitting={isUpdatingGroup}
          onSubmit={submitRenameGroup}
          onOpenChange={handleRenameGroupDialogOpenChange}
        />
      ) : null}

      {renameBase.value ? (
        <KnowledgeBaseNameDialog
          open={editingBase !== null}
          initialName={renameBase.value.name}
          isSubmitting={isUpdatingBase}
          onSubmit={submitRenameBase}
          onOpenChange={handleRenameBaseDialogOpenChange}
        />
      ) : null}

      {restoreBaseDialog.value ? (
        <RestoreKnowledgeBaseDialog
          open={restoringBase !== null}
          base={restoreBaseDialog.value}
          initialEmbeddingModelId={restoreBaseInitialValues?.embeddingModelId}
          isRestoring={isRestoringBase}
          restoreBase={restoreBase}
          onOpenChange={handleRestoreBaseDialogOpenChange}
          onRestored={handleRestoreBaseRestored}
        />
      ) : null}

      {createBaseDialog.isPresent ? (
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
