import { Tooltip } from '@cherrystudio/ui'
import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { Plus } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface ProviderListItemProps {
  provider: Provider
  selected: boolean
  dragging: boolean
  onClick: () => void
  onDuplicate?: () => void
}

export default function ProviderListItem({
  provider,
  selected,
  dragging,
  onClick,
  onDuplicate
}: ProviderListItemProps) {
  const { t } = useTranslation()

  const handleDuplicate = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDuplicate?.()
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
      {onDuplicate && (
        <Tooltip content={t('settings.provider.duplicate.tooltip', { name: provider.name })} placement="top">
          <button
            type="button"
            data-testid={`provider-list-duplicate-${provider.id}`}
            aria-label={t('settings.provider.duplicate.aria_label', { name: provider.name })}
            onClick={handleDuplicate}
            className={providerListClasses.itemDuplicate}>
            <Plus size={12} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
