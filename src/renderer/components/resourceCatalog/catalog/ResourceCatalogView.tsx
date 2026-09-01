import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'
import { ResourceDeleteConfirmDialog } from '@renderer/components/resourceCatalog/dialogs/delete'
import { useResourceCatalogController } from '@renderer/hooks/resourceCatalog'
import type { ResourceType } from '@renderer/types/resourceCatalog'
import { cn } from '@renderer/utils/style'

import { ResourceGrid } from './ResourceGrid'

const ResourceCatalogDialogs = lazy(() =>
  import('./ResourceCatalogDialogs').then((module) => ({ default: module.ResourceCatalogDialogs }))
)

type ResourceCatalogViewType = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

export type ResourceCatalogViewProps = {
  className?: string
  onOpenAssistantChat?: (assistantId: string) => void
  resourceType: ResourceCatalogViewType
  toolbarLeading?: ReactNode
  /** `settings` swaps the full-bleed toolbar for a settings page header (title + add button + search row). */
  variant?: 'library' | 'settings'
  title?: ReactNode
  description?: ReactNode
}

export function ResourceCatalogView({
  className,
  onOpenAssistantChat,
  resourceType,
  toolbarLeading,
  variant = 'library',
  title,
  description
}: ResourceCatalogViewProps) {
  const { t } = useTranslation()
  const { resourceError, refetch, gridProps, dialogs } = useResourceCatalogController(resourceType)
  const hasActiveDialog = Boolean(
    dialogs.selectedSkill ||
    dialogs.assistantImportOpen ||
    (resourceType === 'assistant' && dialogs.assistantLibraryOpen) ||
    dialogs.skillImportOpen ||
    dialogs.skillMarketplaceOpen ||
    (resourceType === 'skill' && dialogs.systemSkillOpen) ||
    dialogs.createDialogOpen ||
    dialogs.createDialogKind ||
    dialogs.editDialogTarget
  )
  const [dialogsActivated, setDialogsActivated] = useState(hasActiveDialog)

  useEffect(() => {
    if (hasActiveDialog) setDialogsActivated(true)
  }, [hasActiveDialog])

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1',
        resourceType === 'skill' ? 'bg-transparent' : variant === 'library' && 'bg-background',
        className
      )}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {resourceError ? (
          <>
            {toolbarLeading ? (
              <div className="flex h-(--navbar-height) shrink-0 items-center gap-2 border-b border-border-subtle px-2">
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
          <ResourceGrid
            {...gridProps}
            onOpenSystemSkills={resourceType === 'skill' ? gridProps.onOpenSystemSkills : undefined}
            toolbarLeading={toolbarLeading}
            variant={variant}
            title={title}
            description={description}
          />
        )}
      </div>

      <ResourceDeleteConfirmDialog resource={dialogs.deleteConfirm} onClose={() => dialogs.setDeleteConfirm(null)} />
      {dialogsActivated ? (
        <Suspense fallback={null}>
          <ResourceCatalogDialogs
            dialogs={dialogs}
            onOpenAssistantChat={onOpenAssistantChat}
            onRefetch={refetch}
            resourceType={resourceType}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
