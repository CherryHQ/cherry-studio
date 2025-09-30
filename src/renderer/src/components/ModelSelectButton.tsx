import type { TooltipProps } from '@cherrystudio/ui'
import { Button, Tooltip } from '@cherrystudio/ui'
import type { Model } from '@renderer/types'
import { useCallback, useMemo } from 'react'

import ModelAvatar from './Avatar/ModelAvatar'
import SelectModelPopup from './Popups/SelectModelPopup'

type Props = {
  model: Model
  onSelectModel: (model: Model) => void
  modelFilter?: (model: Model) => boolean
  noTooltip?: boolean
  tooltipProps?: TooltipProps
}

const ModelSelectButton = ({ model, onSelectModel, modelFilter, noTooltip, tooltipProps }: Props) => {
  const onClick = useCallback(async () => {
    const selectedModel = await SelectModelPopup.show({ model, filter: modelFilter })
    if (selectedModel) {
      onSelectModel?.(selectedModel)
    }
  }, [model, modelFilter, onSelectModel])

  const button = useMemo(() => {
    return (
      <Button
        startContent={<ModelAvatar model={model} size={22} />}
        variant="light"
        radius="full"
        isIconOnly
        onPress={onClick}
      />
    )
  }, [model, onClick])

  if (noTooltip) {
    return button
  } else {
    return (
      <Tooltip content={model.name} {...tooltipProps}>
        {button}
      </Tooltip>
    )
  }
}

export default ModelSelectButton
