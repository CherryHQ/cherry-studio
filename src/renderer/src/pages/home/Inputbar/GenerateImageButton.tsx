import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { isGenerateImageModel } from '@renderer/config/models'
import type { Assistant, Model } from '@renderer/types'
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

  return (
    <Tooltip
      placement="top"
      title={
        isGenerateImageModel(model) ? t('chat.input.generate_image') : t('chat.input.generate_image_not_supported')
      }>
      <ActionIconButton
        onClick={onEnableGenerateImage}
        active={assistant.enableGenerateImage}
        disabled={!isGenerateImageModel(model)}>
        <Image size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default GenerateImageButton
