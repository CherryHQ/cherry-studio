import { Button } from '@cherrystudio/ui'
import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { ArrowLeft } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { getMotionConfig } from '../motion'
import type { OnboardingStep } from '../OnboardingPage'

interface SelectModelPageProps {
  cherryInLoggedIn: boolean
  setStep: (step: OnboardingStep) => void
  onComplete: () => void
  previewMode?: boolean
}

const SelectModelPage: FC<SelectModelPageProps> = ({ cherryInLoggedIn, setStep, onComplete, previewMode }) => {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const motionConfig = getMotionConfig(reducedMotion ?? false)

  const handleBack = () => {
    setStep('welcome')
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      {!cherryInLoggedIn && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 left-4 text-foreground-muted transition-transform duration-150 hover:text-foreground active:scale-[0.98]"
          aria-label={t('common.back')}
          onClick={handleBack}>
          <ArrowLeft size={18} />
        </Button>
      )}
      <motion.div
        className="flex w-96 flex-col gap-6"
        variants={motionConfig.staggerContainerVariants}
        initial="initial"
        animate="animate">
        <motion.div className="flex flex-col gap-2" variants={motionConfig.staggerItemVariants}>
          <h1 className="m-0 font-semibold text-2xl text-foreground">{t('onboarding.select_model.title')}</h1>
          <p className="m-0 text-foreground-secondary text-sm">{t('onboarding.select_model.subtitle')}</p>
        </motion.div>

        <motion.div variants={motionConfig.staggerItemVariants}>
          <ModelSettings showSettingsButton={false} showDescription={false} compact previewMode={previewMode} />
        </motion.div>

        <motion.div variants={motionConfig.staggerItemVariants}>
          <Button size="lg" className="h-12 w-full rounded-lg font-medium text-base" onClick={onComplete}>
            {t('onboarding.select_model.start')}
          </Button>
        </motion.div>

        <motion.p className="m-0 text-center text-foreground-muted text-xs" variants={motionConfig.staggerItemVariants}>
          {t('onboarding.select_model.change_later')}
        </motion.p>
      </motion.div>
    </div>
  )
}

export default SelectModelPage
