import { Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const EmbeddingTag = ({ size = 12, showTooltip, showLabel = true, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#FFA500"
      icon={<Code2 size={size} color="currentColor" className="text-current" />}
      tooltip={showTooltip ? t('models.type.embedding') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.embedding') : ''}
    </CustomTag>
  )
}
