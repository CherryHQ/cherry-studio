import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import type { Group } from '@shared/data/types/group'
import { Copy, Download, MoreHorizontal, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ResourceCardMenu')

function canDuplicateResource(resource: ResourceItem) {
  return resource.type === 'assistant'
}

interface ResourceCardMenuProps {
  resource: ResourceItem
  onClose?: () => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  allGroups: Group[]
  triggerClassName?: string
}

function useResourceCardMenuItems({
  resource,
  onClose,
  onDuplicate,
  onDelete,
  onExport,
  allGroups
}: Omit<ResourceCardMenuProps, 'triggerClassName'>): readonly CommandContextMenuExtraItem[] {
  const { t } = useTranslation()
  const resourceGroupId = resource.type === 'assistant' ? (resource.groupId ?? null) : null
  const [localGroupId, setLocalGroupId] = useState<string | null>(() =>
    resource.type === 'assistant' ? (resource.groupId ?? null) : null
  )
  const [bindingPending, setBindingPending] = useState(false)
  const bindingPendingRef = useRef(false)

  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const canAssignGroup = resource.type === 'assistant'
  const canDuplicate = canDuplicateResource(resource)
  const canExport = resource.type === 'assistant'
  const hasActionsBeforeDelete = canAssignGroup || canDuplicate || canExport

  useEffect(() => {
    if (bindingPendingRef.current) return
    setLocalGroupId(resourceGroupId)
  }, [resource.id, resourceGroupId])

  const persistGroup = useCallback(
    async (nextGroupId: string | null, previousGroupId: string | null) => {
      if (!canAssignGroup) return
      if (bindingPendingRef.current) return
      bindingPendingRef.current = true
      setBindingPending(true)
      try {
        if (resource.type === 'assistant') {
          await updateAssistant({ groupId: nextGroupId })
        }
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalGroupId(previousGroupId)
        const message = e instanceof Error ? e.message : t('library.group_sync_failed')
        toast.error(message)
        logger.error('Failed to sync resource group', e instanceof Error ? e : new Error(String(e)), {
          resourceId: resource.id,
          type: resource.type
        })
      } finally {
        bindingPendingRef.current = false
        setBindingPending(false)
      }
    },
    [canAssignGroup, updateAssistant, resource.id, resource.type, t]
  )

  const selectGroup = useCallback(
    (groupId: string) => {
      if (bindingPendingRef.current) return
      const previousGroupId = localGroupId
      if (previousGroupId === groupId) return
      setLocalGroupId(groupId)
      void persistGroup(groupId, previousGroupId)
      onClose?.()
    },
    [localGroupId, onClose, persistGroup]
  )

  return useMemo(() => {
    const items: CommandContextMenuExtraItem[] = []

    if (canAssignGroup) {
      items.push({
        type: 'submenu',
        id: 'manage-groups',
        label: t('library.action.manage_groups'),
        icon: <Tag size={14} />,
        enabled: !bindingPending,
        children:
          allGroups.length > 0
            ? allGroups.map((group) => ({
                type: 'item' as const,
                id: `group:${group.id}`,
                label: group.name,
                enabled: !bindingPending && localGroupId !== group.id,
                onSelect: () => selectGroup(group.id)
              }))
            : [
                {
                  type: 'item',
                  id: 'groups-empty',
                  label: t('library.group_picker.no_groups'),
                  enabled: false,
                  onSelect: () => {}
                }
              ]
      })
    }

    if (canDuplicate) {
      items.push({
        type: 'item',
        id: 'duplicate',
        label: t('library.action.duplicate'),
        icon: <Copy size={14} />,
        onSelect: () => {
          onDuplicate(resource)
          onClose?.()
        }
      })
    }

    if (canExport) {
      items.push({
        type: 'item',
        id: 'export',
        label: t('assistants.presets.export.agent'),
        icon: <Download size={14} />,
        onSelect: () => {
          onExport(resource)
          onClose?.()
        }
      })
    }

    if (hasActionsBeforeDelete) {
      items.push({ type: 'separator' })
    }

    items.push({
      type: 'item',
      id: 'delete',
      label: resource.type === 'skill' ? t('library.action.uninstall') : t('common.delete'),
      icon: <Trash2 size={14} />,
      destructive: true,
      onSelect: () => {
        onDelete(resource)
        onClose?.()
      }
    })

    return items
  }, [
    allGroups,
    bindingPending,
    canAssignGroup,
    canDuplicate,
    canExport,
    hasActionsBeforeDelete,
    localGroupId,
    onClose,
    onDelete,
    onDuplicate,
    onExport,
    resource,
    t,
    selectGroup
  ])
}

export function ResourceCardMenu({ triggerClassName, ...props }: ResourceCardMenuProps) {
  const { t } = useTranslation()
  const menuItems = useResourceCardMenuItems(props)

  return (
    <CommandPopupMenu
      location="webcontents.context"
      extraItems={menuItems}
      align="end"
      side="bottom"
      sideOffset={6}
      presentationMode="cherry"
      contentClassName="min-w-32 rounded-xl border-border p-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.more')}
        onClick={(e) => e.stopPropagation()}
        className={triggerClassName}>
        <MoreHorizontal size={12} />
      </Button>
    </CommandPopupMenu>
  )
}
