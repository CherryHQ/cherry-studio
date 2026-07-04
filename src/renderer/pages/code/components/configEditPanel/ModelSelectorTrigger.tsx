import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useModelById } from '@renderer/hooks/useModel'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelSelectorTriggerProps {
  value?: UniqueModelId
  placeholder?: string
}

export const ModelSelectorTrigger: FC<ModelSelectorTriggerProps> = ({ value, placeholder }) => {
  const { t } = useTranslation()
  const { model } = useModelById(value ?? null)

  return (
    <button
      type="button"
      className="group flex h-9 w-full min-w-0 items-center justify-between rounded-lg border border-border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {model ? (
          <>
            <ModelAvatar model={model} size={18} />
            <span className="truncate text-foreground">{model.name || model.id}</span>
          </>
        ) : value && isUniqueModelId(value) ? (
          <span className="truncate text-foreground">{parseUniqueModelId(value).modelId}</span>
        ) : (
          <span className="truncate text-muted-foreground/50">{placeholder || t('code.model_placeholder')}</span>
        )}
      </div>
      <ChevronDown
        size={12}
        className="ml-2 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </button>
  )
}
