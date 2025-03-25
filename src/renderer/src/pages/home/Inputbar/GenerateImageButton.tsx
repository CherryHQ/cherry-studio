import { PictureOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  imageGenerationCapable: boolean
  ToolbarButton: any
  onEnableGenerateImage: () => void
}

const GenerateImageButton: FC<Props> = ({ imageGenerationCapable, ToolbarButton, onEnableGenerateImage }) => {
  const { t } = useTranslation()

  if (!imageGenerationCapable) {
    return null
  }

  return (
    <Tooltip
      placement="top"
      title={imageGenerationCapable ? t('chat.input.generate_image') : t('chat.input.generate_image_not_supported')}
      arrow>
      <ToolbarButton type="text" disabled={!imageGenerationCapable} onClick={onEnableGenerateImage}>
        <PictureOutlined style={{ color: imageGenerationCapable ? 'var(--color-link)' : 'var(--color-icon)' }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default GenerateImageButton
