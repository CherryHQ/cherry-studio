import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import { isUniqueModelId, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { ChevronsUpDown, X } from 'lucide-react'
import { useMemo } from 'react'

export const isEmbeddingModel = (model: Model) => model.capabilities.includes(MODEL_CAPABILITY.EMBEDDING)
export const isRerankModel = (model: Model) => model.capabilities.includes(MODEL_CAPABILITY.RERANK)

interface KnowledgeModelSelectFieldProps {
  value: string | null
  filter?: (model: Model) => boolean
  placeholder?: string
  invalid?: boolean
  allowClear?: boolean
  clearLabel?: string
  triggerClassName?: string
  onValueChange: (value: string | null) => void
}

/**
 * Knowledge-base model picker built on the shared {@link ModelSelector}. Renders
 * a trigger button that resolves the current `value` (a UniqueModelId) to its
 * display name, opening the searchable selector popover on click. Used for both
 * embedding and rerank model selection across the RAG panel and the create /
 * restore dialogs.
 */
export const KnowledgeModelSelectField = ({
  value,
  filter,
  placeholder,
  invalid = false,
  allowClear = false,
  clearLabel,
  triggerClassName,
  onValueChange
}: KnowledgeModelSelectFieldProps) => {
  const { models } = useModels({ enabled: true })
  const selectorValue = value && isUniqueModelId(value) ? value : undefined
  const selectedModel = useMemo(
    () => (selectorValue ? models.find((model) => model.id === selectorValue) : undefined),
    [models, selectorValue]
  )
  const triggerLabel = selectedModel?.name ?? value ?? placeholder
  const hasValue = Boolean(value)

  return (
    <div className="flex items-center gap-2">
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={selectorValue}
        filter={filter}
        showTagFilter={false}
        listVisibleCount={8}
        onSelect={(modelId) => onValueChange(modelId ?? null)}
        trigger={
          <Button
            type="button"
            variant="outline"
            aria-invalid={invalid || undefined}
            className={cn(
              'min-h-0 w-full min-w-0 flex-1 justify-between text-foreground shadow-none transition-colors [&_svg]:size-2.5',
              triggerClassName
            )}>
            <span className={cn('min-w-0 truncate text-left', !selectedModel && 'text-muted-foreground')}>
              {triggerLabel}
            </span>
            <ChevronsUpDown className="shrink-0 text-muted-foreground/60" />
          </Button>
        }
      />
      {allowClear && hasValue ? (
        <Tooltip content={clearLabel} placement="top">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={clearLabel}
            onClick={() => onValueChange(null)}
            className="size-7.5 min-h-0 shrink-0 rounded-md border-border/40 p-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground">
            <X className="size-2.5" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}
