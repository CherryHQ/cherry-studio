import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import { ChevronDown, X } from 'lucide-react'
import { useMemo } from 'react'

export { isEmbeddingModel, isRerankModel } from '@shared/utils/model'

interface KnowledgeModelSelectProps {
  value: string | null
  placeholder: string
  filter: (model: Model) => boolean
  invalid?: boolean
  allowClear?: boolean
  clearAriaLabel?: string
  'aria-label'?: string
  onChange: (modelId: string | null) => void
}

/**
 * Knowledge-local wrapper around the shared `ModelSelector`, styled to read like the
 * dialog/panel select triggers it replaces. Capability filtering, search and provider
 * grouping come from `ModelSelector`; tag filter and pinning are turned off here.
 */
export const KnowledgeModelSelect = ({
  value,
  placeholder,
  filter,
  invalid = false,
  allowClear = false,
  clearAriaLabel,
  'aria-label': ariaLabel,
  onChange
}: KnowledgeModelSelectProps) => {
  const { models } = useModels({ enabled: true })
  const selectorValue: UniqueModelId | undefined = value && isUniqueModelId(value) ? value : undefined
  const selectedModel = useMemo(
    () => (selectorValue ? models.find((model) => model.id === selectorValue) : undefined),
    [models, selectorValue]
  )
  const hasValue = Boolean(value)
  const triggerLabel = selectedModel?.name ?? (value || placeholder)

  return (
    <div className="flex items-center gap-1.5">
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={selectorValue}
        filter={filter}
        showTagFilter={false}
        showPinnedModels={false}
        showPinActions={false}
        onSelect={(modelId) => onChange(modelId ?? null)}
        trigger={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            className={cn(
              'h-8 w-full justify-between gap-2 rounded-md px-3 font-normal text-sm shadow-none',
              'aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
              hasValue ? 'text-foreground' : 'text-muted-foreground',
              invalid && 'border-destructive aria-expanded:ring-red-600/20'
            )}>
            <span className="min-w-0 truncate text-left">{triggerLabel}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      {allowClear && hasValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={clearAriaLabel}
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(null)}>
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export default KnowledgeModelSelect
