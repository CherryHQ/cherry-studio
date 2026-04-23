import AddKnowledgeSourceDialog from '../components/AddKnowledgeSourceDialog'
import CreateKnowledgeBaseDialog from '../components/CreateKnowledgeBaseDialog'
import CreateKnowledgeGroupDialog from '../components/CreateKnowledgeGroupDialog'
import KnowledgeBaseNameDialog from '../components/KnowledgeBaseNameDialog'
import RenameKnowledgeGroupDialog from '../components/RenameKnowledgeGroupDialog'
import { useKnowledgePage } from '../KnowledgePageProvider'

const KnowledgePageDialogSection = () => {
  const {
    groups,
    editingBase,
    editingGroup,
    isAddSourceDialogOpen,
    isCreateBaseDialogOpen,
    isCreateGroupDialogOpen,
    isCreatingBase,
    isCreatingGroup,
    isUpdatingBase,
    isUpdatingGroup,
    createBase,
    handleAddSourceDialogOpenChange,
    handleCreateBaseCreated,
    handleCreateBaseDialogOpenChange,
    handleCreateGroupDialogOpenChange,
    handleRenameBaseDialogOpenChange,
    handleRenameGroupDialogOpenChange,
    submitCreateGroup,
    submitRenameBase,
    submitRenameGroup
  } = useKnowledgePage()

  return (
    <>
      {isAddSourceDialogOpen ? (
        <AddKnowledgeSourceDialog open={isAddSourceDialogOpen} onOpenChange={handleAddSourceDialogOpenChange} />
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

      {isCreateBaseDialogOpen ? (
        <CreateKnowledgeBaseDialog
          open={isCreateBaseDialogOpen}
          groups={groups}
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
