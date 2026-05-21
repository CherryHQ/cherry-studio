import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { Check } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OnboardingStep } from '../OnboardingPage'

interface DataSharingPageProps {
  setStep: (step: OnboardingStep) => void
  previewMode?: boolean
}

type Choice = 'share' | 'private'

const DataSharingPage: FC<DataSharingPageProps> = ({ setStep, previewMode }) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Choice>('share')
  const [, setDataCollectionEnabled] = usePreference('app.privacy.data_collection.enabled')

  const handleNext = () => {
    if (!previewMode) {
      setDataCollectionEnabled(selected === 'share')
    }
    setStep('welcome')
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-[480px] flex-col gap-6">
        <div className="flex flex-col items-center gap-4">
          <img src={CherryStudioLogo} alt="Cherry Studio" className="h-16 w-16 rounded-xl" />
          <div className="flex flex-col items-center gap-2">
            <h1 className="m-0 font-semibold text-2xl text-foreground">{t('onboarding.data_sharing.title')}</h1>
            <p className="m-0 max-w-[420px] text-center text-foreground-secondary text-sm">
              {t('onboarding.data_sharing.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <OptionCard
            selected={selected === 'share'}
            onClick={() => setSelected('share')}
            title={t('onboarding.data_sharing.share.title')}
            description={t('onboarding.data_sharing.share.description')}
            items={[
              t('onboarding.data_sharing.share.items.performance'),
              t('onboarding.data_sharing.share.items.model_usage'),
              t('onboarding.data_sharing.share.items.feature_interaction')
            ]}
          />
          <OptionCard
            selected={selected === 'private'}
            onClick={() => setSelected('private')}
            title={t('onboarding.data_sharing.private.title')}
            description={t('onboarding.data_sharing.private.description')}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="m-0 text-foreground-muted text-xs">{t('onboarding.data_sharing.change_later')}</p>
          <Button variant="default" size="lg" onClick={handleNext}>
            {t('onboarding.data_sharing.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface OptionCardProps {
  selected: boolean
  onClick: () => void
  title: string
  description: string
  items?: string[]
}

const OptionCard: FC<OptionCardProps> = ({ selected, onClick, title, description, items }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg border-2 bg-card p-4 text-left transition-colors ${
        selected ? 'border-primary' : 'border-border hover:border-border-hover'
      }`}>
      {selected && (
        <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      <h3 className="m-0 pr-8 font-semibold text-base text-card-foreground">{title}</h3>
      <p className="mt-1 mb-0 pr-8 text-foreground-secondary text-sm">{description}</p>
      {items && items.length > 0 && (
        <ul className="mt-3 mb-0 list-disc space-y-1 pl-5 text-foreground-secondary text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </button>
  )
}

export default DataSharingPage
