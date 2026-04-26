import { ProviderAvatar } from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderAvatar'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { ChevronRight, GripVertical } from 'lucide-react'

interface ProviderListItemProps {
  provider: Provider
  selected: boolean
  dragging: boolean
  customLogos?: Record<string, string>
  onClick: () => void
}

export default function ProviderListItem({
  provider,
  selected,
  dragging,
  customLogos,
  onClick
}: ProviderListItemProps) {
  return (
    <button
      type="button"
      data-testid={`provider-list-item-${provider.id}`}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center justify-between rounded-xl px-2 py-[12px] text-left transition-all',
        selected ? 'bg-cherry-active-bg' : 'border border-transparent hover:bg-accent/40',
        dragging && 'opacity-65'
      )}>
      {selected && (
        <div className="pointer-events-none absolute inset-0 rounded-xl border border-cherry-active-border" />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            'flex shrink-0 text-foreground/40 opacity-0 transition-opacity',
            selected ? 'opacity-100' : 'group-hover:opacity-100'
          )}>
          <GripVertical size={9} />
        </span>
        <ProviderAvatar provider={provider} customLogos={customLogos} size={14} className="shrink-0 rounded-md" />
        <span
          className={cn('truncate text-[13px] leading-[1.35]', selected ? 'text-foreground/90' : 'text-foreground/80')}
          style={{ fontWeight: selected ? 500 : 400 }}>
          {provider.name}
        </span>
      </div>
      <div className={cn('shrink-0', selected ? 'text-foreground/50' : 'text-foreground/35')}>
        <ChevronRight size={9} />
      </div>
    </button>
  )
}
