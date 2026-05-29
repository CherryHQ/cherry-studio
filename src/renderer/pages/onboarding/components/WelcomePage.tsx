import { Button, Label } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { NeutralCheckbox } from '@renderer/components/NeutralCheckbox'
import { useProvider } from '@renderer/hooks/useProvider'
import { fetchModels } from '@renderer/services/ApiService'
import { useAppStore } from '@renderer/store'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { motion, useReducedMotion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getMotionConfig } from '../motion'
import type { OnboardingStep } from '../OnboardingPage'
import BlurTextEffect from './BlurTextEffect'
import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

interface WelcomePageProps {
  onLeaveWelcome: (step: OnboardingStep) => void
  dataSharingEnabled: boolean
  setDataSharingEnabled: (enabled: boolean) => void
  setCherryInLoggedIn: (loggedIn: boolean) => void
  previewMode?: boolean
}

const WelcomePage: FC<WelcomePageProps> = ({
  onLeaveWelcome,
  dataSharingEnabled,
  setDataSharingEnabled,
  setCherryInLoggedIn,
  previewMode
}) => {
  const { t } = useTranslation()
  const { provider, updateProvider, addModel } = useProvider('cherryin')
  const store = useAppStore()
  const [isAddingModels, setIsAddingModels] = useState(false)
  const dataCollectionConsentId = useId()
  const reducedMotion = useReducedMotion()
  const motionConfig = getMotionConfig(reducedMotion ?? false)
  const titleText = t('onboarding.welcome.title')
  const subtitleText = t('onboarding.welcome.subtitle')
  const titleDelay = 0.12
  const subtitleDelay = Math.min(0.72, titleDelay + titleText.length * 0.02)

  const handleCherryInLogin = useCallback(async () => {
    if (previewMode) {
      window.toast.info(t('settings.componentLab.onboarding.mockedLoginToast'))
      setCherryInLoggedIn(true)
      onLeaveWelcome('select-model')
      return
    }
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
          onLeaveWelcome('select-model')
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth Error:', error as Error)
    }
  }, [previewMode, provider, updateProvider, addModel, setCherryInLoggedIn, onLeaveWelcome, t])

  const handleSelectProvider = async () => {
    if (previewMode) {
      window.toast.info(t('settings.componentLab.onboarding.mockedLoginToast'))
      onLeaveWelcome('select-model')
      return
    }
    await ProviderPopup.show()
    const hasAvailableProvider = store.getState().llm.providers.some((p) => p.enabled && p.models.length > 0)
    hasAvailableProvider && onLeaveWelcome('select-model')
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-6"
        variants={motionConfig.staggerContainerVariants}
        initial="initial"
        animate="animate">
        <motion.img
          src={CherryStudioLogo}
          alt="Cherry Studio"
          className="h-16 w-16 rounded-xl"
          variants={motionConfig.logoItemVariants}
        />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-[weight:700] text-2xl text-foreground/90">
            <BlurTextEffect delay={titleDelay}>{titleText}</BlurTextEffect>
          </h1>
          <p className="m-0 text-foreground/90 text-sm">
            <BlurTextEffect delay={subtitleDelay}>{subtitleText}</BlurTextEffect>
          </p>
        </div>

        <motion.div className="mt-4 flex w-100 flex-col gap-5" variants={motionConfig.staggerItemVariants}>
          <Button
            size="lg"
            loading={isAddingModels}
            className="h-12 w-full rounded-lg font-medium text-base"
            onClick={handleCherryInLogin}>
            {t('onboarding.welcome.login_cherryin')}
          </Button>

          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-border-muted" />
            <span className="text-foreground-muted text-xs">{t('onboarding.welcome.or_continue_with')}</span>
            <div className="h-px flex-1 bg-border-muted" />
          </div>

          <Button
            variant="outline"
            size="lg"
            className="h-12 w-full rounded-lg font-medium text-base"
            onClick={handleSelectProvider}>
            {t('onboarding.welcome.other_provider')}
          </Button>

          <Label
            htmlFor={dataCollectionConsentId}
            className="cursor-pointer justify-center gap-2.5 text-center font-normal text-foreground-secondary text-sm leading-5">
            <NeutralCheckbox
              id={dataCollectionConsentId}
              size="sm"
              checked={dataSharingEnabled}
              onCheckedChange={(checked) => setDataSharingEnabled(checked === true)}
            />
            <span>{t('onboarding.welcome.data_collection_consent')}</span>
          </Label>
        </motion.div>
      </motion.div>
    </div>
  )
}

export default WelcomePage
