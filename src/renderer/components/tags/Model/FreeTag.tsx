import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

/** Always a text tag: unlike capability icons, "free" reads as a label wherever it appears. */
export const FreeTag = ({ size = 12, showTooltip, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag size={size} color="#7cb305" tooltip={showTooltip ? t('models.type.free') : undefined} {...restProps}>
      {t('models.type.free')}
    </CustomTag>
  )
}
