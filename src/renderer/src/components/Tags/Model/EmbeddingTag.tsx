import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from '../CustomTag'

type Props = {
  size?: number
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const EmbeddingTag = ({ size, ...restProps }: Props) => {
  const { t } = useTranslation()
  return <CustomTag size={size} color="#FFA500" icon={t('models.type.embedding')} {...restProps} />
}
