import { SubWindowControls } from '@renderer/components/layout/SubWindowControls'
import { SubWindowTitle } from '@renderer/components/layout/SubWindowTitle'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

/**
 * Standalone title bar shared by every detached page. It owns the OS drag region, macOS
 * traffic-light inset, current route title, and window-level pin / back-to-main controls.
 * Page navbars render below it unchanged from their embedded layout.
 */
export const SubWindowTitleBar = () => (
  <header
    className={cn(
      'relative flex w-full shrink-0 select-none items-center gap-2 border-border/50 border-b bg-background [-webkit-app-region:drag]',
      TITLE_BAR_HEIGHT_CLASS,
      // Reserve the top-right corner for the OS window controls overlay (0px on macOS).
      'pr-[calc(0.5rem+var(--window-controls-width,0px))]',
      isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-2'
    )}>
    <SubWindowTitle className="min-w-0 flex-1" />
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <SubWindowControls />
    </div>
  </header>
)
