import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
// Direct `Selector/model` path: the `Selector` barrel's nested `export *` isn't
// resolved by tsgo on main's program (resolves on feat's). Transitional; reverts
// to the barrel once main converges with feat.
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
  onSettingsNavigate?: (navigate: () => void) => void
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
  onSettingsNavigate,
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
        onSettingsNavigate={onSettingsNavigate}
        onSelect={(modelId) => onChange(modelId ?? null)}
        trigger={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            className={cn(
              // The trigger must give way to the clear button beside it, and Button's
              // base class ships `shrink-0`. Both overrides are needed: `shrink` to
              // allow shrinking at all, `min-w-0` to shrink past the label — otherwise
              // a long model name pushes the clear button outside the container.
              'h-8 w-full min-w-0 shrink justify-between gap-2 rounded-md px-3 font-normal text-sm shadow-none',
              'aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
              hasValue ? 'text-foreground' : 'text-muted-foreground',
              invalid &&
                'aria-expanded:border-error-border aria-expanded:ring-error/20 aria-invalid:border-error-border aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 dark:aria-expanded:ring-error/40'
            )}>
            <span className="min-w-0 truncate text-left">{triggerLabel}</span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      {allowClear && hasValue ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={clearAriaLabel}
          className="size-8 shrink-0 rounded-md text-muted-foreground shadow-none hover:text-foreground"
          onClick={() => onChange(null)}>
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

export default KnowledgeModelSelect
