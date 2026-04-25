import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { isGenerateImageModel } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { Image } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  enabled: boolean
  model: Model
  onEnableGenerateImage: () => void
}

const GenerateImageButton: FC<Props> = ({ model, enabled, onEnableGenerateImage }) => {
  const { t } = useTranslation()

  const ariaLabel = isGenerateImageModel(model)
    ? t('chat.input.generate_image')
    : t('chat.input.generate_image_not_supported')

  return (
    <Tooltip placement="top" content={ariaLabel}>
      <ActionIconButton
        onClick={onEnableGenerateImage}
        active={enabled}
        disabled={!isGenerateImageModel(model)}
        aria-label={ariaLabel}
        aria-pressed={enabled}
        icon={<Image size={18} />}
      />
    </Tooltip>
  )
}

export default GenerateImageButton
