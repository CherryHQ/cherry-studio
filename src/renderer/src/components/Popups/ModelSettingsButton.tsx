import { SettingOutlined } from '@ant-design/icons'
import { useProvider } from '@renderer/hooks/useProvider'
import { Model } from '@renderer/types'
import { Button, Tooltip } from 'antd'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ModelEditPopup from './ModelEditPopup'

interface ModelSettingsButtonProps {
  model: Model
  size?: number
  className?: string
}

const ModelSettingsButton: FC<ModelSettingsButtonProps> = ({ model, size = 16, className }) => {
  const { t } = useTranslation()
  const { updateModel } = useProvider(model.provider)

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation() // 防止触发父元素的点击事件
      const updatedModel = await ModelEditPopup.show(model)
      if (updatedModel) {
        updateModel(updatedModel)
      }
    },
    [model, updateModel]
  )

  return (
    <Tooltip title={t('models.edit')} placement="top">
      <StyledButton
        type="text"
        icon={<SettingOutlined style={{ fontSize: size }} />}
        onClick={handleClick}
        className={className}
      />
    </Tooltip>
  )
}

const StyledButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px; // 增加内边距
  margin: 0;
  height: auto;
  width: auto;
  min-width: auto;
  background: transparent;
  border: none;
  opacity: 0.5;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
    background: transparent;
  }
`

export default ModelSettingsButton
