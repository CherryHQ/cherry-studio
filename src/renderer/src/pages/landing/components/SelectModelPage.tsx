import { useLanding } from '@renderer/context/LandingContext'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { Button } from 'antd'
import { ArrowLeft } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const SelectModelPage: FC = () => {
  const { t } = useTranslation()
  const { completeLanding, setStep, cherryInLoggedIn } = useLanding()

  const handleComplete = () => {
    completeLanding()
  }

  const handleBack = () => {
    setStep('welcome')
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      {!cherryInLoggedIn && (
        <Button
          type="text"
          icon={<ArrowLeft size={18} />}
          className="text-(--color-text-3) opacity-50 hover:opacity-80"
          style={{ position: 'absolute', top: 16, left: 16 }}
          onClick={handleBack}
        />
      )}
      <div className="flex w-96 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">{t('landing.select_model.title')}</h1>
          <p className="m-0 text-(--color-text-2) text-sm">{t('landing.select_model.subtitle')}</p>
        </div>

        <ModelSettings showSettingsButton={false} showDescription={false} compact />

        <Button type="primary" size="large" block className="h-12 rounded-lg" onClick={handleComplete}>
          {t('landing.select_model.start')}
        </Button>

        <p className="m-0 text-center text-(--color-text-3) text-xs">{t('landing.select_model.change_later')}</p>
      </div>
    </div>
  )
}

export default SelectModelPage
