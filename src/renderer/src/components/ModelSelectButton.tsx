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
  tooltipPlacement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'left-start'
    | 'left-end'
    | 'right-start'
    | 'right-end'
}

const ModelSelectButton = ({ model, onSelectModel, modelFilter, noTooltip, tooltipPlacement = 'top' }: Props) => {
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
      <Tooltip placement={tooltipPlacement} title={model.name}>
        {button}
      </Tooltip>
    )
  }
}

export default ModelSelectButton
