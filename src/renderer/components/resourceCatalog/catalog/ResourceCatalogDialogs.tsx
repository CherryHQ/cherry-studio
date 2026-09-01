import { ResourceCreateWizard } from '@renderer/components/resourceCatalog/dialogs/create'
import { SkillDetailDialog } from '@renderer/components/resourceCatalog/dialogs/detail'
import { ResourceEditDialogHost } from '@renderer/components/resourceCatalog/dialogs/edit'
import { ImportAssistantDialog } from '@renderer/components/resourceCatalog/dialogs/import'
import {
  ImportSkillDialog,
  SkillMarketplaceDialog,
  SystemSkillDialog
} from '@renderer/components/resourceCatalog/dialogs/skill'
import type { useResourceCatalogController } from '@renderer/hooks/resourceCatalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { isNonChatModel } from '@shared/utils/model'

import { AssistantLibraryDialog } from './AssistantLibraryDialog'

type ResourceCatalogDialogsProps = {
  dialogs: ReturnType<typeof useResourceCatalogController>['dialogs']
  onOpenAssistantChat?: (assistantId: string) => void
  onRefetch: ReturnType<typeof useResourceCatalogController>['refetch']
  resourceType: Extract<ResourceType, 'assistant' | 'agent' | 'skill'>
  onSelectedSkillIdChange?: (skillId: string | undefined) => void
}

export function ResourceCatalogDialogs({
  dialogs,
  onOpenAssistantChat,
  onRefetch,
  resourceType,
  onSelectedSkillIdChange
}: ResourceCatalogDialogsProps) {
  return (
    <>
      <SkillDetailDialog
        skill={dialogs.selectedSkill}
        open={Boolean(dialogs.selectedSkill)}
        onOpenChange={(open) => {
          if (!open) {
            dialogs.setSelectedSkill(null)
            onSelectedSkillIdChange?.(undefined)
          }
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
        modelFilter={dialogs.createDialogKind === 'agent' ? undefined : (candidate) => !isNonChatModel(candidate)}
        onOpenChange={dialogs.handleCreateDialogOpenChange}
        onSubmit={dialogs.handleSubmitCreateResource}
      />
      <ResourceEditDialogHost
        target={dialogs.editDialogTarget}
        onOpenChange={(open) => {
          if (!open) dialogs.setEditDialogTarget(null)
        }}
      />
    </>
  )
}
