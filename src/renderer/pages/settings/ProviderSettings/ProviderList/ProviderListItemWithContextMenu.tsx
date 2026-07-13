import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import ModelNotesPopup from '@renderer/pages/settings/ProviderSettings/ModelNotesPopup'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { cn } from '@renderer/utils/style'
import type { Provider } from '@shared/data/types/provider'
import { CopyPlus, Edit, Trash2, UserPen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderListItem from '../components/ProviderListItem'

type ListDragState = { dragging: boolean }

interface ProviderListItemWithContextMenuProps {
  provider: Provider
  selected: boolean
  contextOpen: boolean
  onContextOpenChange: (open: boolean) => void
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate?: () => void
  showManagementActions: boolean
  listState: ListDragState
  onSetListItemRef: (providerId: string, element: HTMLDivElement | null) => void
}

// CommandContextMenu/CommandPopupMenu's extra items have no per-item className, so the
// provider list's row-height/radius styling is applied via descendant selectors instead.
const menuContentClassName = cn(
  providerListClasses.itemMenuContent,
  '[&_[data-slot=context-menu-item]]:h-8 [&_[data-slot=context-menu-item]]:rounded-lg [&_[data-slot=context-menu-item]]:px-2.5',
  '[&_[data-slot=dropdown-menu-item]]:h-8 [&_[data-slot=dropdown-menu-item]]:rounded-lg [&_[data-slot=dropdown-menu-item]]:px-2.5'
)

export default function ProviderListItemWithContextMenu({
  provider,
  selected,
  contextOpen,
  onContextOpenChange,
  onSelect,
  onEdit,
  onDelete,
  onDuplicate,
  showManagementActions,
  listState,
  onSetListItemRef
}: ProviderListItemWithContextMenuProps) {
  const { t } = useTranslation()

  const menuItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const items: CommandContextMenuExtraItem[] = []

    if (showManagementActions) {
      items.push({
        type: 'item',
        id: 'edit',
        label: t('common.edit'),
        icon: <Edit className="size-3.5 text-current" />,
        onSelect: onEdit
      })
    }

    if (onDuplicate) {
      items.push({
        type: 'item',
        id: 'duplicate',
        label: t('settings.provider.duplicate.menu_label'),
        icon: <CopyPlus className="size-3.5 text-current" />,
        onSelect: onDuplicate
      })
    }

    items.push({
      type: 'item',
      id: 'notes',
      label: t('settings.provider.notes.title'),
      icon: <UserPen className="size-3.5 text-current" />,
      onSelect: () => ModelNotesPopup.show({ providerId: provider.id })
    })

    if (showManagementActions) {
      items.push({
        type: 'item',
        id: 'delete',
        label: t('common.delete'),
        icon: <Trash2 className="size-3.5 text-current" />,
        destructive: true,
        onSelect: onDelete
      })
    }

    return items
  }, [onDelete, onDuplicate, onEdit, provider.id, showManagementActions, t])

  return (
    <CommandContextMenu location="webcontents.context" extraItems={menuItems} contentClassName={menuContentClassName}>
      <div className="w-full" ref={(element) => onSetListItemRef(provider.id, element)}>
        <ProviderListItem
          provider={{ ...provider, name: getFancyProviderName(provider) }}
          selected={selected}
          dragging={listState.dragging}
          onClick={onSelect}
          // Opening is handled by CommandPopupMenu's own Radix trigger below; this only
          // needs to be truthy so ProviderListItem renders the button (with stopPropagation).
          onOpenMenu={() => {}}
          renderMenuButton={(button) => (
            <CommandPopupMenu
              location="webcontents.context"
              extraItems={menuItems}
              align="end"
              contentClassName={menuContentClassName}
              open={contextOpen}
              onOpenChange={onContextOpenChange}>
              {button}
            </CommandPopupMenu>
          )}
        />
      </div>
    </CommandContextMenu>
  )
}
