import type { PropsWithChildren } from 'react'
import { createContext, use, useState } from 'react'

const LANDING_COMPLETED_KEY = 'landing-page-completed'

interface LandingContextType {
  landingCompleted: boolean
  completeLanding: () => void
}

const LandingContext = createContext<LandingContextType>({
  landingCompleted: false,
  completeLanding: () => {}
})

export const useLanding = () => use(LandingContext)

export const LandingProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [landingCompleted, setLandingCompleted] = useState(() => localStorage.getItem(LANDING_COMPLETED_KEY) === 'true')

  const completeLanding = () => {
    localStorage.setItem(LANDING_COMPLETED_KEY, 'true')
    window.location.hash = '/'
    setLandingCompleted(true)
  }

  return <LandingContext value={{ landingCompleted, completeLanding }}>{children}</LandingContext>
}
