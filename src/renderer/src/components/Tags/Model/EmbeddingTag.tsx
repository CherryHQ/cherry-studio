import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const EmbeddingTag = ({ size, ...restProps }: Props) => {
  const { t } = useTranslation()
  return <Tag size={size} color="#FFA500" icon={t('models.type.embedding')} {...restProps} />
}
