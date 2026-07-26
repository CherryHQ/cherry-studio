import { ResourceCreateWizard } from '@renderer/components/resourceCatalog/dialogs/create'
import { SkillDetailDialog } from '@renderer/components/resourceCatalog/dialogs/detail'
import { AgentEditDialog, AssistantEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { ImportAssistantDialog } from '@renderer/components/resourceCatalog/dialogs/import'
import {
  ImportSkillDialog,
  SkillMarketplaceDialog,
  SystemSkillDialog
} from '@renderer/components/resourceCatalog/dialogs/skill'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import type { useResourceCatalogController } from '@renderer/hooks/resourceCatalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'

import { AssistantLibraryDialog } from './AssistantLibraryDialog'

type ResourceCatalogDialogsProps = {
  dialogs: ReturnType<typeof useResourceCatalogController>['dialogs']
  onOpenAssistantChat?: (assistantId: string) => void
  onRefetch: ReturnType<typeof useResourceCatalogController>['refetch']
  resourceType: Extract<ResourceType, 'assistant' | 'agent' | 'skill'>
}

export function ResourceCatalogDialogs({
  dialogs,
  onOpenAssistantChat,
  onRefetch,
  resourceType
}: ResourceCatalogDialogsProps) {
  const agentModelFilter = useAgentModelFilter('claude-code')

  return (
    <>
      <SkillDetailDialog
        skill={dialogs.selectedSkill}
        open={Boolean(dialogs.selectedSkill)}
        onOpenChange={(open) => {
          if (!open) dialogs.setSelectedSkill(null)
        }}
      />
      <ImportAssistantDialog
        open={dialogs.assistantImportOpen}
        onOpenChange={dialogs.setAssistantImportOpen}
        onImported={onRefetch}
      />
      {resourceType === 'assistant' ? (
        <AssistantLibraryDialog
          open={dialogs.assistantLibraryOpen}
          onOpenChange={dialogs.setAssistantLibraryOpen}
          onAssistantAdded={onRefetch}
          onOpenAssistantChat={onOpenAssistantChat}
        />
      ) : null}
      <ImportSkillDialog open={dialogs.skillImportOpen} onOpenChange={dialogs.setSkillImportOpen} />
      <SkillMarketplaceDialog open={dialogs.skillMarketplaceOpen} onOpenChange={dialogs.setSkillMarketplaceOpen} />
      {resourceType === 'skill' ? (
        <SystemSkillDialog mode="manage" open={dialogs.systemSkillOpen} onOpenChange={dialogs.setSystemSkillOpen} />
      ) : null}
      <ResourceCreateWizard
        kind={dialogs.createDialogKind ?? 'assistant'}
        open={dialogs.createDialogOpen}
        isSubmitting={dialogs.creatingResource}
        modelFilter={dialogs.createDialogKind === 'agent' ? agentModelFilter : isSelectableAssistantModel}
        onOpenChange={dialogs.handleCreateDialogOpenChange}
        onSubmit={dialogs.handleSubmitCreateResource}
      />
      {dialogs.editDialog?.kind === 'assistant' ? (
        <AssistantEditDialog
          open={dialogs.editDialogOpen}
          resource={dialogs.editDialog.resource}
          modelFilter={isSelectableAssistantModel}
          onOpenChange={dialogs.handleEditDialogOpenChange}
          onSaved={dialogs.handleEditSaved}
        />
      ) : null}
      {dialogs.editDialog?.kind === 'agent' ? (
        <AgentEditDialog
          open={dialogs.editDialogOpen}
          resource={dialogs.editDialog.resource}
          modelFilter={agentModelFilter}
          onOpenChange={dialogs.handleEditDialogOpenChange}
          onSaved={dialogs.handleEditSaved}
        />
      ) : null}
    </>
  )
}
