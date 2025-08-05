import { useTranslation } from 'react-i18next'

import CustomTag from './CustomTag'

type Props = {
  size?: number
}

export const EmbeddingTag = ({ size }: Props) => {
  const { t } = useTranslation()
  return <CustomTag size={size} color="#FFA500" icon={t('models.type.embedding')}></CustomTag>
}
