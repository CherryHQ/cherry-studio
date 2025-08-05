import { useTranslation } from 'react-i18next'

import CustomTag from './CustomTag'

type Props = {
  size?: number
}

export const RerankerTag = ({ size }: Props) => {
  const { t } = useTranslation()
  return <CustomTag size={size} color="#6495ED" icon={t('models.type.rerank')} />
}
