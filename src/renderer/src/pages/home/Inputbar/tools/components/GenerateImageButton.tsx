import { ActionIconButton } from '@renderer/components/Buttons'
import { isGenerateImageModel } from '@renderer/config/models'
import type { Assistant, Model } from '@renderer/types'
import { Tooltip } from 'antd'
import { Image } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  model: Model
  onEnableGenerateImage: () => void
}

const GenerateImageButton: FC<Props> = ({ model, assistant, onEnableGenerateImage }) => {
  const { t } = useTranslation()

  const ariaLabel = isGenerateImageModel(model)
    ? t('chat.input.generate_image')
    : t('chat.input.generate_image_not_supported')

  return (
    <Tooltip placement="top" title={ariaLabel} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={onEnableGenerateImage}
        active={assistant.enableGenerateImage}
        disabled={!isGenerateImageModel(model)}
        aria-label={ariaLabel}
        aria-pressed={assistant.enableGenerateImage}>
        <Image size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default GenerateImageButton
