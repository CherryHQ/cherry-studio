import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const FreeTag = ({ size, showTooltip, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <Tag
      size={size}
      color="#7cb305"
      icon={t('models.type.free')}
      tooltip={showTooltip ? t('models.type.free') : undefined}
      {...restProps}
    />
  )
}
