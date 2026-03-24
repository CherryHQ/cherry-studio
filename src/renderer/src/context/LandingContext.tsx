import type { PropsWithChildren } from 'react'
import { createContext, use, useCallback, useState } from 'react'

const LANDING_COMPLETED_KEY = 'landing-page-completed'

export type LandingStep = 'welcome' | 'select-model'

interface LandingContextType {
  landingCompleted: boolean
  step: LandingStep
  cherryInLoggedIn: boolean
  setStep: (step: LandingStep) => void
  setCherryInLoggedIn: (loggedIn: boolean) => void
  completeLanding: () => void
}

const LandingContext = createContext<LandingContextType>({
  landingCompleted: false,
  step: 'welcome',
  cherryInLoggedIn: false,
  setStep: () => {},
  setCherryInLoggedIn: () => {},
  completeLanding: () => {}
})

export const useLanding = () => use(LandingContext)

export const LandingProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [landingCompleted, setLandingCompleted] = useState(() => localStorage.getItem(LANDING_COMPLETED_KEY) === 'true')
  const [step, setStep] = useState<LandingStep>('welcome')
  const [cherryInLoggedIn, setCherryInLoggedIn] = useState(false)

  const completeLanding = useCallback(() => {
    localStorage.setItem(LANDING_COMPLETED_KEY, 'true')
    window.location.hash = '/'
    setLandingCompleted(true)
  }, [])

  return (
    <LandingContext
      value={{
        landingCompleted,
        step,
        cherryInLoggedIn,
        setStep,
        setCherryInLoggedIn,
        completeLanding
      }}>
      {children}
    </LandingContext>
  )
}
