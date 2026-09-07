import type { BrowserPageController } from './BrowserPageController'
import type { CdpBrowserController } from './controller'

export type BrowserController = Pick<
  CdpBrowserController,
  | 'open'
  | 'fetch'
  | 'execute'
  | 'screenshot'
  | 'takeNewTabId'
  | 'listTabs'
  | 'switchTab'
  | 'closeTab'
  | 'reset'
  | 'dispose'
  | 'validateUrl'
> &
  Pick<BrowserPageController, 'getSession'> & {
    readonly signal?: AbortSignal
    takeHostEvents?: (tabId: string) => Record<string, unknown>
    assertAvailable?: () => void
  }
