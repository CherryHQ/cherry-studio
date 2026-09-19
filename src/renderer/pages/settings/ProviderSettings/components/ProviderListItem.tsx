import { GripVertical, MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { freeAccessKindOf } from '@shared/data/presets/freeTierProviders'
import type { Provider } from '@shared/data/types/provider'

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
  const { t } = useTranslation()
  const freeAccess = freeAccessKindOf(provider.id)
  const handleOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenMenu?.()
  }
  const hasTrailingSlot = provider.isEnabled || onOpenMenu
  const menuButton = onOpenMenu ? (
    <button
      type="button"
      data-testid={`provider-list-menu-${provider.id}`}
      onClick={handleOpenMenu}
      className={providerListClasses.itemMoreActions}>
      <MoreVertical size={14} />
    </button>
  ) : null

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
          <ProviderAvatar
            provider={provider}
            size={26}
            className={providerListClasses.itemAvatar}
            displayContext="provider-list"
          />
          <span className={providerListClasses.itemLabel}>{provider.name}</span>
          {/* Sixty providers in one list, and nothing said which of them cost nothing to try. */}
          {freeAccess ? (
            <Tooltip content={t(`settings.provider.free_access.${freeAccess}_tip`)}>
              <span className="shrink-0 rounded-md bg-success-subtle px-1.5 py-0.5 text-[10px] text-success-subtle-foreground">
                {t(`settings.provider.free_access.${freeAccess}`)}
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {hasTrailingSlot && (
        <div
          className={cn(
            providerListClasses.itemTrailingSlot,
            provider.isEnabled
              ? providerListClasses.itemTrailingSlotIndicatorOnly
              : providerListClasses.itemTrailingSlotAction
          )}>
          {provider.isEnabled && <span aria-hidden className={providerListClasses.itemEnabledDot} />}
          {menuButton && (renderMenuButton ? renderMenuButton(menuButton) : menuButton)}
        </div>
      )}
    </div>
  )
}
