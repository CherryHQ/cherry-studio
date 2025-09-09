import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from '../CustomTag'

type Props = {
  size?: number
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const RerankerTag = ({ size, ...restProps }: Props) => {
  const { t } = useTranslation()
  return <CustomTag size={size} color="#6495ED" icon={t('models.type.rerank')} {...restProps} />
}
