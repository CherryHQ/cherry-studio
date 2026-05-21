import WindowControls from '@renderer/components/WindowControls'
import type { FC } from 'react'
import { useState } from 'react'

import DataSharingPage from './components/DataSharingPage'
import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

export type OnboardingStep = 'data-sharing' | 'welcome' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void
  previewMode?: boolean
}

const OnboardingPage: FC<OnboardingPageProps> = ({ onComplete, previewMode }) => {
  const [step, setStep] = useState<OnboardingStep>('data-sharing')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 px-2 pb-2">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-(--color-background)">
          {!previewMode && <SkipButton onSkip={onComplete} />}
          {step === 'data-sharing' && <DataSharingPage setStep={setStep} previewMode={previewMode} />}
          {step === 'welcome' && (
            <WelcomePage setStep={setStep} setCherryInLoggedIn={setCherryInLoggedIn} previewMode={previewMode} />
          )}
          {step === 'select-model' && (
            <SelectModelPage
              cherryInLoggedIn={cherryInLoggedIn}
              setStep={setStep}
              onComplete={onComplete}
              previewMode={previewMode}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
