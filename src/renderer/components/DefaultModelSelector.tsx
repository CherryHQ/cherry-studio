import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { getProviderDisplayName, ModelSelector } from '@renderer/components/ModelSelector'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'
import { type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps, FC } from 'react'

export interface ModelSelectorTriggerProps extends Omit<ComponentProps<typeof Button>, 'children' | 'onSelect'> {
  model?: Model
  providers: Provider[]
  placeholder: string
  compact?: boolean
}

export interface DefaultModelSelectorProps extends ModelSelectorTriggerProps {
  filter: (model: Model) => boolean
  onSelect: (model: Model | undefined) => void
}

const getModelInitial = (model: Model) => model.name.trim().charAt(0) || 'M'

export const ModelSelectorTriggerButton: FC<ModelSelectorTriggerProps> = ({
  model,
  providers,
  placeholder,
  compact,
  className,
  ...props
}) => {
  const provider = model ? providers.find((item) => item.id === model.providerId) : undefined
  const providerName = provider ? getProviderDisplayName(provider) : undefined
  const icon = useIcon(model ? getModelLogoRef(model) : undefined)

  return (
    <Button
      {...props}
      type="button"
      variant="outline"
      size={compact ? 'lg' : 'default'}
      className={cn(
        'min-w-0 flex-1 justify-between px-2.5 text-left font-normal',
        compact ? 'h-9' : 'h-7.5',
        className
      )}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {model && icon ? (
          <icon.Avatar size={20} />
        ) : model ? (
          <Avatar size="sm">
            <AvatarFallback>{getModelInitial(model)}</AvatarFallback>
          </Avatar>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{model?.name ?? placeholder}</span>
        {providerName && <span className="max-w-[32%] truncate text-muted-foreground text-xs">{providerName}</span>}
      </span>
      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
    </Button>
  )
}

export const DefaultModelSelector: FC<DefaultModelSelectorProps> = ({
  model,
  providers,
  placeholder,
  compact,
  filter,
  onSelect
}) => (
  <ModelSelector
    multiple={false}
    value={model}
    onSelect={onSelect}
    filter={filter}
    trigger={
      <ModelSelectorTriggerButton model={model} providers={providers} placeholder={placeholder} compact={compact} />
    }
  />
)
