import { Tag, type TagProps, Tooltip } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
} & Omit<TagProps, 'size' | 'icon' | 'color' | 'children'>

export const FreeTag = ({ size, showTooltip, ...restProps }: Props) => {
  const { t } = useTranslation()

  const tag = <Tag size={size} color="#7cb305" icon={t('models.type.free')} {...restProps} />

  return showTooltip ? (
    <Tooltip content={t('models.type.free')} delay={300}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}
