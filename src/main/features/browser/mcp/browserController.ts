import type { BrowserPageController } from './BrowserPageController'
import type { CdpBrowserController } from './controller'

export type BrowserController = Pick<
  CdpBrowserController,
  'fetch' | 'execute' | 'screenshot' | 'takeNewTabId' | 'listTabs' | 'dispose' | 'validateUrl'
> &
  Partial<Pick<CdpBrowserController, 'switchTab' | 'closeTab' | 'reset'>> &
  Pick<BrowserPageController, 'getSession' | 'open'> & {
    readonly signal?: AbortSignal
    takeHostEvents?: (tabId: string) => Record<string, unknown>
    assertAvailable?: () => void
    beginTool?: (signal: AbortSignal) => void
    finishTool?: () => void
  }
