import { use } from 'react'

import { QuickPanelContext, QuickPanelControllerContext } from './QuickPanelProvider'

export const useQuickPanel = () => {
  const context = use(QuickPanelContext)
  if (!context) {
    throw new Error('useQuickPanel must be used within a QuickPanelProvider')
  }
  return context
}

/** Like {@link useQuickPanel}, but returns null instead of throwing when no provider is mounted. */
export const useOptionalQuickPanel = () => use(QuickPanelContext)

export const useQuickPanelController = () => {
  const controller = use(QuickPanelControllerContext)
  if (!controller) {
    throw new Error('useQuickPanelController must be used within a QuickPanelProvider')
  }
  return controller
}
