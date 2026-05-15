import type { TooltipProps } from '@cherrystudio/ui'
import { Button, Tooltip } from '@cherrystudio/ui'
import { ModelSelector } from '@renderer/components/Selector'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import type { Model } from '@renderer/types'
import type { Model as SharedModel } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

import ModelAvatar from './Avatar/ModelAvatar'

type Props = {
  model: Model
  onSelectModel: (model: Model) => void
  /** Filter operates on the shared Model (the same shape ModelSelector iterates). */
  modelFilter?: (model: SharedModel) => boolean
  noTooltip?: boolean
  tooltipProps?: TooltipProps
}

const ModelSelectButton = ({ model, onSelectModel, modelFilter, noTooltip, tooltipProps }: Props) => {
  const handleSelect = useCallback(
    (next: SharedModel | undefined) => {
      if (!next) return
      onSelectModel(fromSharedModel(next))
    },
    [onSelectModel]
  )

  const button = useMemo(
    () => (
      <Button variant="ghost" className="rounded-full" size="icon">
        <ModelAvatar model={model} size={22} />
      </Button>
    ),
    [model]
  )

  const triggerWithTooltip = noTooltip ? (
    button
  ) : (
    <Tooltip content={model.name} {...tooltipProps}>
      {button}
    </Tooltip>
  )

  return <ModelSelector multiple={false} onSelect={handleSelect} filter={modelFilter} trigger={triggerWithTooltip} />
}

export default ModelSelectButton
