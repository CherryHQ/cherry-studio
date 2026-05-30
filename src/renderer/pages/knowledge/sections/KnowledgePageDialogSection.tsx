import AddKnowledgeItemDialog from '../components/AddKnowledgeItemDialog'
import CreateKnowledgeBaseDialog from '../components/CreateKnowledgeBaseDialog'
import CreateKnowledgeGroupDialog from '../components/CreateKnowledgeGroupDialog'
import KnowledgeBaseNameDialog from '../components/KnowledgeBaseNameDialog'
import RenameKnowledgeGroupDialog from '../components/RenameKnowledgeGroupDialog'
import RestoreKnowledgeBaseDialog from '../components/RestoreKnowledgeBaseDialog'
import { useKnowledgePage } from '../KnowledgePageProvider'

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
    <>
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
          initialDimensions={restoreBaseInitialValues?.dimensions}
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
    </>
  )
}

export default KnowledgePageDialogSection
