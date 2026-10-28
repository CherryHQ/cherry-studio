import { createContext, type ReactNode, use } from 'react'

const MandatoryGateContext = createContext(false)

/**
 * Publishes whether a mandatory, non-dismissable gate (e.g. the privacy-policy update) currently
 * owns the window. Transient prompts read `useMandatoryGateOpen` and defer instead of stacking.
 */
export function MandatoryGateProvider({ open, children }: { open: boolean; children: ReactNode }) {
  return <MandatoryGateContext value={open}>{children}</MandatoryGateContext>
}

export function useMandatoryGateOpen(): boolean {
  return use(MandatoryGateContext)
}
