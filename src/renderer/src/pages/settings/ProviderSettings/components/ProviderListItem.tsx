import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettings/components/ProviderAvatar'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/shared/primitives/ProviderSettingsPrimitives'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { ChevronRight } from 'lucide-react'

interface ProviderListItemProps {
  provider: Provider
  selected: boolean
  dragging: boolean
  onClick: () => void
}

export default function ProviderListItem({ provider, selected, dragging, onClick }: ProviderListItemProps) {
  return (
    <button
      type="button"
      data-testid={`provider-list-item-${provider.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      onClick={onClick}
      className={cn(
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
      <div className={cn('shrink-0', selected ? 'text-muted-foreground/60' : 'text-muted-foreground/40')}>
        <ChevronRight size={10} />
      </div>
    </button>
  )
}
