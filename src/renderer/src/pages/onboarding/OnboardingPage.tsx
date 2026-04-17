import WindowControls from '@renderer/components/WindowControls'
import type { FC } from 'react'
import { useState } from 'react'

import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

export type OnboardingStep = 'welcome' | 'select-model'

interface OnboardingPageProps {
  onComplete: () => void
}

const OnboardingPage: FC<OnboardingPageProps> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 px-2 pb-2">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-(--color-background)">
          <SkipButton onSkip={onComplete} />
          {step === 'welcome' && <WelcomePage setStep={setStep} setCherryInLoggedIn={setCherryInLoggedIn} />}
          {step === 'select-model' && (
            <SelectModelPage cherryInLoggedIn={cherryInLoggedIn} setStep={setStep} onComplete={onComplete} />
          )}
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
