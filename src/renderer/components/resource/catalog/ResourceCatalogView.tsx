import { Alert, Button } from '@cherrystudio/ui'
import {
  AgentEditDialog,
  AssistantEditDialog,
  ImportAssistantDialog,
  ImportSkillDialog,
  PromptEditDialog,
  ResourceCreateWizard,
  ResourceDeleteConfirmDialog,
  SkillDetailDialog
} from '@renderer/components/resource/dialogs'
import { isSelectableAssistantModel } from '@renderer/components/resource/dialogs/form/assistantModelFilter'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useResourceCatalogController } from '@renderer/hooks/resourceCatalog/useResourceCatalogController'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'
import { useTranslation } from 'react-i18next'

import { AssistantLibraryDialog } from './AssistantLibraryDialog'
import { ResourceGrid } from './ResourceGrid'

export type ResourceCatalogViewProps = {
  className?: string
  onOpenAssistantChat?: (assistantId: string) => void
  resourceType: ResourceType
}

export function ResourceCatalogView({ className, onOpenAssistantChat, resourceType }: ResourceCatalogViewProps) {
  const { t } = useTranslation()
  const agentModelFilter = useAgentModelFilter('claude-code')
  const { resourceError, refetch, gridProps, dialogs } = useResourceCatalogController(resourceType)

  return (
    <div className={cn('flex min-h-0 flex-1 bg-background', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {resourceError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <Alert
              type="error"
              showIcon
              message={t('common.error')}
              description={resourceError.message}
              action={
                <Button variant="outline" size="sm" onClick={refetch}>
                  {t('common.retry')}
                </Button>
              }
              className="max-w-lg rounded-md px-4 py-3 shadow-none"
            />
          </div>
        ) : (
          <ResourceGrid {...gridProps} />
        )}
      </div>

      <ResourceDeleteConfirmDialog resource={dialogs.deleteConfirm} onClose={() => dialogs.setDeleteConfirm(null)} />
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
        onImported={refetch}
      />
      {resourceType === 'assistant' ? (
        <AssistantLibraryDialog
          open={dialogs.assistantLibraryOpen}
          onOpenChange={dialogs.setAssistantLibraryOpen}
          onAssistantAdded={refetch}
          onOpenAssistantChat={onOpenAssistantChat}
        />
      ) : null}
      <ImportSkillDialog
        open={dialogs.skillImportOpen}
        onOpenChange={dialogs.setSkillImportOpen}
        onInstalled={refetch}
      />
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
      <PromptEditDialog
        open={dialogs.promptDialogOpen}
        prompt={dialogs.promptDialogPrompt}
        onSave={dialogs.handlePromptDialogSave}
        onCancel={dialogs.handleClosePromptDialog}
      />
    </div>
  )
}
