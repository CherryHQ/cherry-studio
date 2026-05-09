import { MenuItem, MenuList, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import ModelNotesPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelNotesPopup'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettingsV2/shared/primitives/ProviderSettingsPrimitives'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { Edit, Trash2, UserPen } from 'lucide-react'
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
  showManagementActions,
  listState,
  onSetListItemRef
}: ProviderListItemWithContextMenuProps) {
  const { t } = useTranslation()

  return (
    <Popover open={contextOpen} onOpenChange={onContextOpenChange}>
      <PopoverAnchor asChild>
        <div
          className="w-full"
          ref={(element) => onSetListItemRef(provider.id, element)}
          onContextMenu={(event) => {
            event.preventDefault()
            onContextOpenChange(true)
          }}>
          <ProviderListItem
            provider={{ ...provider, name: getFancyProviderName(provider) }}
            selected={selected}
            dragging={listState.dragging}
            onClick={onSelect}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className={cn(providerListClasses.itemMenuContent, 'w-44')}>
        <MenuList>
          {showManagementActions && (
            <MenuItem
              label={t('common.edit')}
              className={providerListClasses.itemMenuEntry}
              icon={<Edit size={14} />}
              onClick={onEdit}
            />
          )}
          <MenuItem
            label={t('settings.provider.notes.title')}
            className={providerListClasses.itemMenuEntry}
            icon={<UserPen size={14} />}
            onClick={() => ModelNotesPopup.show({ providerId: provider.id })}
          />
          {showManagementActions && (
            <MenuItem
              label={t('common.delete')}
              icon={<Trash2 size={14} />}
              onClick={onDelete}
              className={cn(providerListClasses.itemMenuEntry, 'text-(--color-destructive)')}
            />
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
