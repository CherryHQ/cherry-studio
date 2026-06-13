import { SubWindowControls } from '@renderer/components/layout/SubWindowControls'
import { SubWindowTitle } from '@renderer/components/layout/SubWindowTitle'
import { TITLE_BAR_HEIGHT_CLASS } from '@renderer/components/layout/titleBar'
import { isMac } from '@renderer/config/constant'
import { cn } from '@renderer/utils'

/**
 * Standalone window title bar for detached pages that DON'T render their own window chrome
 * (mini-apps, settings, files, …). Chat/agent pages merge the same chrome into their navbar
 * via ConversationShell, so this is only used for the rest. Provides the OS drag region +
 * macOS traffic-light inset + conversation title + pin / back-to-main controls — without it
 * a non-chat/agent sub-window has no draggable region.
 */
export const SubWindowTitleBar = () => (
  <header
    className={cn(
      'relative flex w-full shrink-0 select-none items-center gap-2 border-border/50 border-b bg-background [-webkit-app-region:drag]',
      TITLE_BAR_HEIGHT_CLASS,
      isMac ? 'pr-2 pl-[env(titlebar-area-x)]' : 'px-2'
    )}>
    <SubWindowTitle className="min-w-0 flex-1" />
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <SubWindowControls />
    </div>
  </header>
)
