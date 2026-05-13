import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { MoreVertical } from 'lucide-react'
import type { MouseEvent } from 'react'

interface ProviderListItemProps {
  provider: Provider
  selected: boolean
  dragging: boolean
  onClick: () => void
  onOpenMenu?: () => void
}

export default function ProviderListItem({ provider, selected, dragging, onClick, onOpenMenu }: ProviderListItemProps) {
  const handleOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenMenu?.()
  }

  return (
    <div
      data-testid={`provider-list-item-${provider.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group/row cursor-pointer',
        providerListClasses.item,
        selected ? providerListClasses.itemSelected : providerListClasses.itemIdle,
        dragging && 'opacity-65'
      )}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ProviderAvatar provider={provider} size={18} className={providerListClasses.itemAvatar} />
        <span
          className={cn(providerListClasses.itemLabel, selected ? 'font-medium text-foreground' : 'text-foreground')}>
          {provider.name}
        </span>
      </div>
      {onOpenMenu && (
        <button
          type="button"
          data-testid={`provider-list-menu-${provider.id}`}
          onClick={handleOpenMenu}
          className={providerListClasses.itemMoreActions}>
          <MoreVertical size={14} />
        </button>
      )}
    </div>
  )
}
