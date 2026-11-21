import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

/** Amber from the approved subscription prototype; the lock and the label share it. */
const SUBSCRIPTION_TAG_COLOR = '#d48806'

type Props = {
  size?: number
  /** Replaces the default "Subscription" text, e.g. the partner whose sign-up unlocks the model. */
  label?: string
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

/** Marks a plan model the account cannot use yet. */
export const SubscriptionTag = ({ size = 12, label, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color={SUBSCRIPTION_TAG_COLOR}
      icon={<Lock size={size} color="currentColor" className="text-current" aria-hidden="true" />}
      {...restProps}>
      {label ?? t('models.type.subscription')}
    </CustomTag>
  )
}
