import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { useModelMutations } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { fetchModels } from '@renderer/services/ApiService'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import { parseUniqueModelId } from '@shared/data/types/model'
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
  const { provider, updateProvider, addApiKey } = useProvider('cherryin')
  const { createModels } = useModelMutations()
  const [isAddingModels, setIsAddingModels] = useState(false)

  const handleCherryInLogin = useCallback(async () => {
    try {
      await oauthWithCherryIn(
        async (apiKeys: string) => {
          // Persist the OAuth key + enable the provider via DataApi. Main reads
          // the key from DB on the subsequent listModels IPC.
          await addApiKey(apiKeys, 'OAuth')
          await updateProvider({ isEnabled: true })

          setIsAddingModels(true)
          try {
            const models = provider ? await fetchModels(provider) : []
            const dtos: CreateModelDto[] = models
              .filter((m): m is typeof m & { id: string } => Boolean(m.id))
              .map((m) => ({
                providerId: 'cherryin',
                modelId: m.apiModelId ?? parseUniqueModelId(m.id).modelId,
                name: m.name,
                group: m.group,
                ...(m.endpointTypes ? { endpointTypes: m.endpointTypes } : {})
              }))
            if (dtos.length > 0) {
              await createModels(dtos)
              logger.info(`Auto-added ${dtos.length} models from CherryIN`)
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
  }, [provider, updateProvider, addApiKey, createModels, setCherryInLoggedIn, setStep, t])

  const handleSelectProvider = async () => {
    await ProviderPopup.show()
    // One-shot fresh read for the gate — SWR cache would be stale this tick.
    const enabled = await dataApiService.get('/providers', { query: { enabled: true } })
    if (enabled.length > 0) {
      setStep('select-model')
    }
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
