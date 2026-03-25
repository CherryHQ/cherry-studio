import { loggerService } from '@logger'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { useProvider } from '@renderer/hooks/useProvider'
import { fetchModels } from '@renderer/services/ApiService'
import { useAppStore } from '@renderer/store'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { Button, Divider } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OnboardingStep } from '../OnboardingPage'
import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

interface WelcomePageProps {
  setStep: (step: OnboardingStep) => void
  setCherryInLoggedIn: (loggedIn: boolean) => void
}

const WelcomePage: FC<WelcomePageProps> = ({ setStep, setCherryInLoggedIn }) => {
  const { t } = useTranslation()
  const { provider, updateProvider, addModel } = useProvider('cherryin')
  const store = useAppStore()
  const [isAddingModels, setIsAddingModels] = useState(false)

  const handleCherryInLogin = useCallback(async () => {
    try {
      await oauthWithCherryIn(
        async (apiKeys: string) => {
          updateProvider({ apiKey: apiKeys, enabled: true })

          // Fetch and add models
          setIsAddingModels(true)

          try {
            const updatedProvider = { ...provider, apiKey: apiKeys, enabled: true }
            const models = await fetchModels(updatedProvider)
            if (models.length > 0) {
              models.forEach((model) => addModel(model))
              logger.info(`Auto-added ${models.length} models from CherryIN`)
            }
          } catch (fetchError) {
            logger.warn('Failed to auto-fetch models:', fetchError as Error)
          } finally {
            setIsAddingModels(false)
          }

          setCherryInLoggedIn(true)
          window.toast.success(t('onboarding.toast.connected'))
          setStep('select-model')
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth Error:', error as Error)
    }
  }, [provider, updateProvider, addModel, setCherryInLoggedIn, setStep, t])

  const handleSelectProvider = async () => {
    await ProviderPopup.show()
    const hasAvailableProvider = store.getState().llm.providers.some((p) => p.enabled && p.models.length > 0)
    hasAvailableProvider && setStep('select-model')
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <img src={CherryStudioLogo} alt="Cherry Studio" className="h-16 w-16 rounded-xl" />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">{t('onboarding.welcome.title')}</h1>
          <p className="m-0 text-(--color-text-2) text-sm">{t('onboarding.welcome.subtitle')}</p>
        </div>

        <div className="mt-2 flex w-100 flex-col gap-3">
          <Button
            type="primary"
            size="large"
            block
            loading={isAddingModels}
            className="h-12 rounded-lg"
            onClick={handleCherryInLogin}>
            {t('onboarding.welcome.login_cherryin')}
          </Button>

          <Divider className="my-1!">
            <span className="text-(--color-text-3) text-xs">{t('onboarding.welcome.or_continue_with')}</span>
          </Divider>

          <Button size="large" block className="h-12 rounded-lg" onClick={handleSelectProvider}>
            {t('onboarding.welcome.other_provider')}
          </Button>
        </div>

        <p className="mt-1 text-(--color-text-3) text-xs">{t('onboarding.welcome.setup_hint')}</p>
      </div>
    </div>
  )
}

export default WelcomePage
