import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useState } from 'react'

const ONBOARDING_COMPLETED_KEY = 'onboarding-completed'

export type OnboardingStep = 'welcome' | 'select-model'

interface OnboardingContextType {
  onboardingCompleted: boolean
  step: OnboardingStep
  cherryInLoggedIn: boolean
  setStep: (step: OnboardingStep) => void
  setCherryInLoggedIn: (loggedIn: boolean) => void
  completeOnboarding: () => void
}

const OnboardingContext = createContext<OnboardingContextType>({
  onboardingCompleted: false,
  step: 'welcome',
  cherryInLoggedIn: false,
  setStep: () => {},
  setCherryInLoggedIn: () => {},
  completeOnboarding: () => {}
})

export const useOnboarding = () => use(OnboardingContext)

export const OnboardingProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    () => localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
  )
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    window.location.hash = '/'
    setOnboardingCompleted(true)
  }, [])

  return (
    <OnboardingContext
      value={{
        onboardingCompleted,
        step,
        cherryInLoggedIn,
        setStep,
        setCherryInLoggedIn,
        completeOnboarding
      }}>
      {children}
    </OnboardingContext>
  )
}
