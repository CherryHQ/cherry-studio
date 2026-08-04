import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import ModelNotesPopup from '@renderer/pages/settings/ProviderSettings/ModelNotesPopup'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
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

  const menuItems = useMemo<readonly CommandContextMenuExtraItem[]>(() => {
    const items: CommandContextMenuExtraItem[] = []
    if (showManagementActions) {
      items.push({
        type: 'item',
        id: 'edit',
        label: t('common.edit'),
        icon: <Edit size={14} />,
        onSelect: onEdit
      })
    }
    if (onDuplicate) {
      items.push({
        type: 'item',
        id: 'duplicate',
        label: t('settings.provider.duplicate.menu_label'),
        icon: <CopyPlus size={14} />,
        onSelect: onDuplicate
      })
    }
    items.push({
      type: 'item',
      id: 'notes',
      label: t('settings.provider.notes.title'),
      icon: <UserPen size={14} />,
      onSelect: () => ModelNotesPopup.show({ providerId: provider.id })
    })
    if (showManagementActions) {
      items.push({
        type: 'item',
        id: 'delete',
        label: t('common.delete'),
        icon: <Trash2 size={14} />,
        destructive: true,
        onSelect: onDelete
      })
    }
    return items
  }, [onDelete, onDuplicate, onEdit, provider.id, showManagementActions, t])

  // Right-click stays uncontrolled — Radix handles cross-popup mutex naturally.
  // The more-button popup remains controlled so the parent's single-row-active-at-a-time
  // tracking (`contextProviderId`) keeps working across clicks between rows.
  return (
    <CommandContextMenu location="webcontents.context" extraItems={menuItems}>
      <div className="w-full" ref={(element) => onSetListItemRef(provider.id, element)}>
        <ProviderListItem
          provider={{ ...provider, name: getFancyProviderName(provider) }}
          selected={selected}
          dragging={listState.dragging}
          onClick={onSelect}
          onOpenMenu={() => onContextOpenChange(true)}
          renderMenuButton={(button) => (
            <CommandPopupMenu
              location="webcontents.context"
              extraItems={menuItems}
              open={contextOpen}
              onOpenChange={onContextOpenChange}
              align="end"
              contentClassName={providerListClasses.itemMenuContent}>
              {button}
            </CommandPopupMenu>
          )}
        />
      </div>
    </CommandContextMenu>
  )
}
