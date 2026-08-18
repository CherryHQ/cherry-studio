import type { Tab } from '@shared/data/cache/cacheValueTypes'

export type MainWindowInitData =
  | {
      kind: 'navigation'
      to: string
      requestId: number
    }
  | {
      /** Re-attach a detached tab when the main window is rebuilt around it (see openTabInMainWindow). */
      kind: 'tab-attach'
      tab: Tab
      requestId: number
    }
