import { AppShellTabBar } from '@renderer/components/layout/AppShellTabBar'
import { SubWindowControls } from '@renderer/components/layout/SubWindowControls'
import { useTabs } from '@renderer/hooks/tab'

export const SubWindowTitleBar = ({ isFullscreen }: { isFullscreen: boolean }) => {
  const tabs = useTabs()
  return (
    <AppShellTabBar
      {...tabs}
      isFullscreen={isFullscreen}
      actions={
        <div className="flex shrink-0 items-center gap-0.5 pr-[var(--window-controls-width,0px)] [-webkit-app-region:no-drag]">
          <SubWindowControls />
        </div>
      }
    />
  )
}
