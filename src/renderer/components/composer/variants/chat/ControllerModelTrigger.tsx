import { Network, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector, type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useModelById } from '@renderer/hooks/useModel'
import { cn } from '@renderer/utils/style'
import type { Model, UniqueModelId } from '@shared/data/types/model'

interface Props {
  /** Hidden below two models: there is nothing to divide between one. */
  workerCount: number
  filter?: ModelSelectorFilter
  side: 'top' | 'bottom'
  disabled?: boolean
  className?: string
}

/**
 * Picks the model that coordinates the others: it splits the request between the selected
 * models and merges what comes back. Empty means they each answer the whole request.
 */
export function ControllerModelTrigger({ workerCount, filter, side, disabled, className }: Props) {
  const { t } = useTranslation()
  const [controllerModelId, setControllerModelId] = usePreference('chat.routing.controller_model')
  const { model: controller } = useModelById((controllerModelId || undefined) as UniqueModelId | undefined)

  const handleSelect = useCallback(
    (model: Model | undefined) => {
      void setControllerModelId(model?.id ?? '')
    },
    [setControllerModelId]
  )

  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      void setControllerModelId('')
    },
    [setControllerModelId]
  )

  if (workerCount < 2) return null

  const label = controller ? controller.name : t('chat.controller.none')

  return (
    <ModelSelector
      multiple={false}
      value={controller ?? undefined}
      onSelect={handleSelect}
      filter={filter}
      side={side}
      align="start"
      mountStrategy="lazy-keep"
      trigger={
        <Button variant="ghost" size="sm" className={className} disabled={disabled}>
          <Tooltip content={t('chat.controller.tooltip')}>
            <span className="flex items-center gap-1.5">
              {controller ? <ModelAvatar model={controller} size={20} /> : <Network size={14} aria-hidden />}
              <span className={cn('max-w-40 truncate', !controller && 'text-muted-foreground')} title={label}>
                {label}
              </span>
            </span>
          </Tooltip>
          {controller ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('chat.controller.clear')}
              className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') handleClear(event as unknown as React.MouseEvent)
              }}>
              <X size={12} aria-hidden />
            </span>
          ) : null}
        </Button>
      }
    />
  )
}
