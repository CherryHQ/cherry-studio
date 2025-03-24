import { PictureOutlined } from '@ant-design/icons'
import { isGenerateImageModel } from '@renderer/config/models'
import { Assistant, Model } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  model: Model
  ToolbarButton: any
  onEnableGenerateImage: () => void
}

const GenerateImageButton: FC<Props> = ({ model, ToolbarButton, assistant, onEnableGenerateImage }) => {
  const { t } = useTranslation()

  if (!isGenerateImageModel(model)) {
    return null
  }

  return (
    <Tooltip
      placement="top"
      title={
        isGenerateImageModel(model) ? t('chat.input.generate_image') : t('chat.input.generate_image_not_supported')
      }
      arrow>
      <ToolbarButton type="text" disabled={!isGenerateImageModel(model)} onClick={onEnableGenerateImage}>
        <PictureOutlined style={{ color: assistant.enableGenerateImage ? 'var(--color-link)' : 'var(--color-icon)' }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default GenerateImageButton
