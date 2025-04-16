import { use } from 'react'

import { QuickPanelContext } from './provider'

export const useQuickPanel = () => {
  const context = use(QuickPanelContext)
  if (!context) {
    throw new Error('useQuickPanel must be used within a QuickPanelProvider')
  }
  return context
}
