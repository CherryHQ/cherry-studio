import { Button } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface SkipButtonProps {
  onSkip: () => void
}

const SkipButton: FC<SkipButtonProps> = ({ onSkip }) => {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="absolute top-4 right-4 z-10 text-foreground-muted hover:text-foreground"
      onClick={onSkip}>
      {t('onboarding.skip')}
    </Button>
  )
}

export default SkipButton
