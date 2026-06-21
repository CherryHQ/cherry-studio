import { use } from 'react'

import { QuickPanelContext } from './provider'

export const useQuickPanel = () => {
  const context = use(QuickPanelContext)
  if (!context) {
    throw new Error('useQuickPanel must be used within a QuickPanelProvider')
  }
  return context
}

/** Like {@link useQuickPanel}, but returns null instead of throwing when no provider is mounted. */
export const useOptionalQuickPanel = () => use(QuickPanelContext)
