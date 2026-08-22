import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/icons/SidebarToggleIcons'
import { getSidebarLayout, getSidebarPeekWidth, SIDEBAR_ICON_WIDTH } from '@renderer/components/Sidebar'
import { useTranslation } from 'react-i18next'

export function AppSidebarToggleButton({ peekOpen = false }: { peekOpen?: boolean }) {
  const { t } = useTranslation()
  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [expandedWidth] = usePersistCache('ui.sidebar.expanded_width')
  const isHidden = getSidebarLayout(sidebarWidth) === 'hidden'
  const label = isHidden ? t('navbar.show_sidebar') : t('navbar.hide_sidebar')
  const ToggleIcon = isHidden ? SidebarExpandIcon : SidebarCollapseIcon

  const toggleSidebar = () => {
    if (!isHidden) {
      setSidebarWidth(0)
      return
    }
    // Pin what the user is looking at: the hover overlay widens an icon-band memory
    // to stay readable, so snapping back to the rail would jump under the cursor.
    if (peekOpen) {
      setSidebarWidth(getSidebarPeekWidth(expandedWidth))
      return
    }

    // A stale hidden value in the restore slot would make the button a no-op.
    setSidebarWidth(getSidebarLayout(expandedWidth) === 'hidden' ? SIDEBAR_ICON_WIDTH : expandedWidth)
  }

  return (
    <Tooltip content={label} placement="bottom" delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={!isHidden}
        onClick={toggleSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
        <ToggleIcon className="size-[18px]" />
      </Button>
    </Tooltip>
  )
}
