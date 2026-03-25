import WindowControls from '@renderer/components/WindowControls'
import { useOnboarding } from '@renderer/context/OnboardingContext'
import type { FC } from 'react'

import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

const OnboardingPage: FC = () => {
  const { step } = useOnboarding()

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="drag flex w-full shrink-0 items-center justify-end" style={{ height: 'var(--navbar-height)' }}>
        <WindowControls />
      </div>
      <div className="flex flex-1 px-2 pb-2">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-(--color-background)">
          <SkipButton />
          {step === 'welcome' && <WelcomePage />}
          {step === 'select-model' && <SelectModelPage />}
        </div>
      </div>
    </div>
  )
}

export default OnboardingPage
