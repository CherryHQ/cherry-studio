import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useEnsureTags } from '@renderer/hooks/useTags'
import { toast } from '@renderer/services/toast'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { getRandomTagColor } from '@renderer/utils/resourceCatalog'
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
  allTagNames: string[]
  triggerClassName?: string
}

function useResourceCardMenuItems({
  resource,
  onClose,
  onDuplicate,
  onDelete,
  onExport,
  allTagNames
}: Omit<ResourceCardMenuProps, 'triggerClassName'>): readonly CommandContextMenuExtraItem[] {
  const { t } = useTranslation()
  const resourceTag = resource.type === 'assistant' ? (resource.tag ?? null) : null
  const [localTag, setLocalTag] = useState<string | null>(() =>
    resource.type === 'assistant' ? (resource.tag ?? null) : null
  )
  const [bindingPending, setBindingPending] = useState(false)
  const bindingPendingRef = useRef(false)

  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const canBindTags = resource.type === 'assistant'
  const canDuplicate = canDuplicateResource(resource)
  const canExport = resource.type === 'assistant'
  const hasActionsBeforeDelete = canBindTags || canDuplicate || canExport

  useEffect(() => {
    if (bindingPendingRef.current) return
    setLocalTag(resourceTag)
  }, [resource.id, resourceTag])

  const persistTag = useCallback(
    async (nextName: string | null, previousName: string | null) => {
      if (!canBindTags) return
      if (bindingPendingRef.current) return
      bindingPendingRef.current = true
      setBindingPending(true)
      try {
        const nextNames = nextName ? [nextName] : []
        const tags = await ensureTags(nextNames)
        const tagIds = tags.map((tag) => tag.id)
        if (resource.type === 'assistant') {
          await updateAssistant({ tagIds })
        }
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalTag(previousName)
        const message = e instanceof Error ? e.message : t('library.tag_sync_failed')
        toast.error(message)
        logger.error('Failed to sync resource tags', e instanceof Error ? e : new Error(String(e)), {
          resourceId: resource.id,
          type: resource.type
        })
      } finally {
        bindingPendingRef.current = false
        setBindingPending(false)
      }
    },
    [canBindTags, ensureTags, updateAssistant, resource.id, resource.type, t]
  )

  const selectTag = useCallback(
    (tag: string) => {
      if (bindingPendingRef.current) return
      const prev = localTag
      if (prev === tag) return
      const next = tag
      setLocalTag(next)
      void persistTag(next, prev)
      onClose?.()
    },
    [localTag, onClose, persistTag]
  )

  return useMemo(() => {
    const items: CommandContextMenuExtraItem[] = []

    if (canBindTags) {
      items.push({
        type: 'submenu',
        id: 'manage-tags',
        label: t('library.action.manage_tags'),
        icon: <Tag size={14} />,
        enabled: !bindingPending,
        children:
          allTagNames.length > 0
            ? allTagNames.map((tag) => ({
                type: 'item' as const,
                id: `tag:${tag}`,
                label: tag,
                enabled: !bindingPending && localTag !== tag,
                onSelect: () => selectTag(tag)
              }))
            : [
                {
                  type: 'item',
                  id: 'tags-empty',
                  label: t('library.tag_picker.no_tags'),
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
    allTagNames,
    bindingPending,
    canBindTags,
    canDuplicate,
    canExport,
    hasActionsBeforeDelete,
    localTag,
    onClose,
    onDelete,
    onDuplicate,
    onExport,
    resource,
    t,
    selectTag
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
