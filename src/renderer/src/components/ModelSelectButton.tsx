import { Model } from '@renderer/types'
import { Button, Tooltip, TooltipProps } from 'antd'
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
    const selectedModel = await SelectModelPopup.show({ model, modelFilter })
    if (selectedModel) {
      onSelectModel?.(selectedModel)
    }
  }, [model, modelFilter, onSelectModel])

  const button = useMemo(() => {
    return <Button icon={<ModelAvatar model={model} size={22} />} type="text" shape="circle" onClick={onClick} />
  }, [model, onClick])

  if (noTooltip) {
    return button
  } else {
    return (
      <Tooltip title={model.name} {...tooltipProps}>
        {button}
      </Tooltip>
    )
  }
}

export default ModelSelectButton
