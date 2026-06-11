import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { GripVertical, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'

interface ProviderListItemProps {
  provider: Provider
  selected: boolean
  dragging: boolean
  onClick: () => void
  onOpenMenu?: () => void
  renderMenuButton?: (button: ReactNode) => ReactNode
}

export default function ProviderListItem({
  provider,
  selected,
  dragging,
  onClick,
  onOpenMenu,
  renderMenuButton
}: ProviderListItemProps) {
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
        // Only intercept Enter / Space when the row itself is focused.
        // Without this guard, keydown on the inner kebab button bubbles up,
        // preventDefault here suppresses the button's native click action,
        // and the menu cannot be opened via keyboard.
        if (event.currentTarget !== event.target) return
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
      <div className={providerListClasses.itemMain}>
        <span
          aria-hidden
          data-testid={`provider-list-drag-handle-${provider.id}`}
          data-dragging={dragging ? 'true' : 'false'}
          className={providerListClasses.itemDragHandle}>
          <GripVertical size={16} />
        </span>
        <div className={providerListClasses.itemIdentity}>
          <ProviderAvatar provider={provider} size={26} className={providerListClasses.itemAvatar} />
          <span className={providerListClasses.itemLabel}>{provider.name}</span>
        </div>
      </div>
      {provider.isEnabled && <span aria-hidden className={providerListClasses.itemEnabledDot} />}
      {onOpenMenu &&
        (renderMenuButton ? (
          renderMenuButton(
            <button
              type="button"
              data-testid={`provider-list-menu-${provider.id}`}
              onClick={handleOpenMenu}
              className={providerListClasses.itemMoreActions}>
              <MoreVertical size={14} />
            </button>
          )
        ) : (
          <button
            type="button"
            data-testid={`provider-list-menu-${provider.id}`}
            onClick={handleOpenMenu}
            className={providerListClasses.itemMoreActions}>
            <MoreVertical size={14} />
          </button>
        ))}
    </div>
  )
}
