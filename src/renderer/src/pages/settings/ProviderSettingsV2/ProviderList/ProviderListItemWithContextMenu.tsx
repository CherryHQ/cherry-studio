import { MenuItem, MenuList, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import ModelNotesPopup from '@renderer/pages/settings/ProviderSettingsV2/ModelNotesPopup'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import type { Provider } from '@shared/data/types/provider'
import { Edit, Trash2, UserPen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ProviderListItem from '../components/ProviderListItem'

type DragState = { dragging: boolean }

interface ProviderListItemWithContextMenuProps {
  provider: Provider
  selectedProviderId?: string
  customLogos: Record<string, string>
  contextOpen: boolean
  onContextOpenChange: (open: boolean) => void
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  showManagementActions: boolean
  listState: DragState
  onSetListItemRef: (providerId: string, element: HTMLDivElement | null) => void
}

export default function ProviderListItemWithContextMenu({
  provider,
  selectedProviderId,
  customLogos,
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
            selected={provider.id === selectedProviderId}
            dragging={listState.dragging}
            customLogos={customLogos}
            onClick={onSelect}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-44 p-1">
        <MenuList>
          {showManagementActions && (
            <MenuItem
              label={t('common.edit')}
              className="rounded-3xs px-2 py-[5px] text-[13px] hover:bg-accent/40"
              icon={<Edit size={14} />}
              onClick={onEdit}
            />
          )}
          <MenuItem
            label={t('settings.provider.notes.title')}
            className="rounded-3xs px-2 py-[5px] text-[13px] hover:bg-accent/40"
            icon={<UserPen size={14} />}
            onClick={() => ModelNotesPopup.show({ providerId: provider.id })}
          />
          {showManagementActions && (
            <MenuItem
              label={t('common.delete')}
              icon={<Trash2 size={14} />}
              onClick={onDelete}
              className="rounded-3xs px-2 py-[5px] text-(--color-destructive) text-[13px] hover:bg-accent/40"
            />
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
