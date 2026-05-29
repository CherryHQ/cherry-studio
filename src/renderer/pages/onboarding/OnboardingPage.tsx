import { usePreference } from '@data/hooks/usePreference'
import WindowControls from '@renderer/components/WindowControls'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useState } from 'react'

import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'
import { getMotionConfig } from './motion'

export type OnboardingStep = 'welcome' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void
  previewMode?: boolean
}

const OnboardingPage: FC<OnboardingPageProps> = ({ onComplete, previewMode }) => {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)
  const [dataSharingEnabled, setDataSharingEnabled] = useState(true)
  const [, setDataCollectionEnabled] = usePreference('app.privacy.data_collection.enabled')
  const reducedMotion = useReducedMotion()
  const motionConfig = getMotionConfig(reducedMotion ?? false)

  const persistDataSharingPreference = useCallback(() => {
    if (!previewMode) {
      void setDataCollectionEnabled(dataSharingEnabled)
    }
  }, [dataSharingEnabled, previewMode, setDataCollectionEnabled])

  const handleLeaveWelcome = useCallback(
    (nextStep: OnboardingStep) => {
      persistDataSharingPreference()
      setStep(nextStep)
    },
    [persistDataSharingPreference]
  )

  const handleSkip = useCallback(() => {
    persistDataSharingPreference()
    onComplete()
  }, [onComplete, persistDataSharingPreference])

  const handleComplete = useCallback(() => {
    persistDataSharingPreference()
    onComplete()
  }, [onComplete, persistDataSharingPreference])

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 px-2 pb-2">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-background">
          <SkipButton onSkip={handleSkip} />
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              className="absolute inset-0 flex h-full w-full"
              variants={motionConfig.pageVariants}
              initial="initial"
              animate="animate"
              exit="exit">
              {step === 'welcome' && (
                <WelcomePage
                  onLeaveWelcome={handleLeaveWelcome}
                  dataSharingEnabled={dataSharingEnabled}
                  setDataSharingEnabled={setDataSharingEnabled}
                  setCherryInLoggedIn={setCherryInLoggedIn}
                  previewMode={previewMode}
                />
              )}
              {step === 'select-model' && (
                <SelectModelPage
                  cherryInLoggedIn={cherryInLoggedIn}
                  setStep={setStep}
                  onComplete={handleComplete}
                  previewMode={previewMode}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
