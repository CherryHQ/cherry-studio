import { Alert, Button } from '@cherrystudio/ui'
import { ResourceCreateWizard } from '@renderer/components/resourceCatalog/dialogs/create'
import { ResourceDeleteConfirmDialog } from '@renderer/components/resourceCatalog/dialogs/delete'
import { SkillDetailDialog } from '@renderer/components/resourceCatalog/dialogs/detail'
import { AgentEditDialog, AssistantEditDialog } from '@renderer/components/resourceCatalog/dialogs/edit'
import { ImportAssistantDialog, ImportSkillDialog } from '@renderer/components/resourceCatalog/dialogs/import'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { useResourceCatalogController } from '@renderer/hooks/resourceCatalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'
import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AssistantLibraryDialog } from './AssistantLibraryDialog'
import { ResourceGrid } from './ResourceGrid'

type ResourceCatalogViewType = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

export type ResourceCatalogViewProps = {
  className?: string
  onOpenAssistantChat?: (assistantId: string) => void
  resourceType: ResourceCatalogViewType
  toolbarLeading?: ReactNode
}

export function ResourceCatalogView({
  className,
  onOpenAssistantChat,
  resourceType,
  toolbarLeading
}: ResourceCatalogViewProps) {
  const { t } = useTranslation()
  const agentModelFilter = useAgentModelFilter('claude-code')
  const { resourceError, refetch, gridProps, dialogs } = useResourceCatalogController(resourceType)

  return (
    <div className={cn('flex min-h-0 flex-1 bg-background', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {resourceError ? (
          <>
            {toolbarLeading ? (
              <div className="flex h-(--navbar-height) shrink-0 items-center gap-2 border-border-muted border-b px-2">
                <div className="flex shrink-0 items-center">{toolbarLeading}</div>
              </div>
            ) : null}
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
          </>
        ) : (
          <ResourceGrid {...gridProps} toolbarLeading={toolbarLeading} />
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
    </div>
  )
}
