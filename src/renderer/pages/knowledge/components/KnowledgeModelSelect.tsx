import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
// Direct `Selector/model` path: the `Selector` barrel's nested `export *` isn't
// resolved by tsgo on main's program (resolves on feat's). Transitional; reverts
// to the barrel once main converges with feat.
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import { ChevronDown } from 'lucide-react'
import { useMemo } from 'react'

export { isEmbeddingModel, isRerankModel } from '@shared/utils/model'

export interface KnowledgeModelSelectProps {
  value: string | null
  placeholder: string
  filter: (model: Model) => boolean
  invalid?: boolean
  noneOptionLabel?: string
  'aria-label'?: string
  onSettingsNavigate?: (navigate: () => void) => void
  prioritizedProviderIds?: readonly string[]
  onChange: (modelId: string | null) => void
}

/**
 * Knowledge-local wrapper around the shared `ModelSelector`, styled to read like the
 * dialog/panel select triggers it replaces. Capability filtering, search and provider
 * grouping come from `ModelSelector`; the tag filter is hidden while Pin behavior is retained.
 */
export const KnowledgeModelSelect = ({
  value,
  placeholder,
  filter,
  invalid = false,
  noneOptionLabel,
  'aria-label': ariaLabel,
  onSettingsNavigate,
  prioritizedProviderIds,
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
    <ModelSelector
      multiple={false}
      selectionType="id"
      value={selectorValue}
      filter={filter}
      noneOptionLabel={noneOptionLabel}
      prioritizedProviderIds={prioritizedProviderIds}
      showTagFilter={false}
      onSettingsNavigate={onSettingsNavigate}
      onSelect={(modelId) => onChange(modelId ?? null)}
      trigger={
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-8 w-full min-w-0 justify-between gap-2 rounded-md border-input bg-transparent px-3 font-normal text-sm shadow-none hover:border-border-strong hover:bg-transparent focus-visible:border-ring focus-visible:bg-transparent aria-expanded:bg-transparent dark:bg-transparent',
            hasValue ? 'text-foreground' : 'text-muted-foreground',
            invalid &&
              'aria-expanded:border-error-border aria-expanded:ring-error/20 aria-invalid:border-error-border aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 dark:aria-expanded:ring-error/40'
          )}>
          <span className="min-w-0 truncate text-left">{triggerLabel}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      }
    />
  )
}

export default KnowledgeModelSelect
