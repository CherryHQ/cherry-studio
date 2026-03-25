import { useOnboarding } from '@renderer/context/OnboardingContext'
import { Button } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const SkipButton: FC = () => {
  const { t } = useTranslation()
  const { completeOnboarding } = useOnboarding()

  return (
    <Button
      type="text"
      className="text-(--color-text-3) opacity-50 hover:opacity-80"
      style={{ position: 'absolute', top: 16, right: 16, width: 'auto' }}
      onClick={completeOnboarding}>
      {t('onboarding.skip')}
    </Button>
  )
}

export default SkipButton
