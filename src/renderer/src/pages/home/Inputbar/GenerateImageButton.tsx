import { isGenerateImageModel } from '@renderer/config/models'
import { Assistant, Model } from '@renderer/types'
import { Tooltip } from 'antd'
import { Image } from 'lucide-react'
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

  return (
    <Tooltip
      placement="top"
      title={
        isGenerateImageModel(model) ? t('chat.input.generate_image') : t('chat.input.generate_image_not_supported')
      }
      mouseLeaveDelay={0}
      arrow>
      <ToolbarButton type="text" disabled={!isGenerateImageModel(model)} onClick={onEnableGenerateImage}>
        <Image size={18} color={assistant.enableGenerateImage ? 'var(--color-link)' : 'var(--color-icon)'} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default GenerateImageButton
