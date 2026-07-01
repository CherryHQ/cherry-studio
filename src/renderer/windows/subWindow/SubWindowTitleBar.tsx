import { SubWindowControls } from '@renderer/components/layout/SubWindowControls'
import { SubWindowTitle } from '@renderer/components/layout/SubWindowTitle'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import { isMac } from '@renderer/utils/platform'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { cn } from '@renderer/utils/style'

/**
 * Standalone window title bar for detached pages that DON'T render their own window chrome
 * (mini-apps, files, …). Chat/agent pages merge the same chrome into their navbar via
 * ConversationShell, and settings renders its own; this is only used for the rest. Provides
 * the OS drag region + macOS traffic-light inset + conversation title + pin / back-to-main
 * controls. Sits on the sidebar-tinted window background so the framed content card below it
 * reads as a floating panel (matching the detached settings window).
 */
export const SubWindowTitleBar = () => {
  const isMacTransparentWindow = useMacTransparentWindow()

  return (
    <header
      className={cn(
        'relative flex w-full shrink-0 select-none items-center gap-2 [-webkit-app-region:drag]',
        TITLE_BAR_HEIGHT_CLASS,
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar',
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
}
