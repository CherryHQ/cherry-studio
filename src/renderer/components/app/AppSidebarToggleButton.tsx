import { Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/icons/SidebarToggleIcons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { getSidebarLayout, getSidebarPeekWidth, SIDEBAR_ICON_WIDTH } from '@renderer/components/Sidebar'
import { useTranslation } from 'react-i18next'

/** NavbarIcon's `icon-navbar` size — the footprint the shell keeps clear for this button. */
export const APP_SIDEBAR_TOGGLE_SIZE = 30
/** Gap between the toggle and whatever the shell lays out after it. */
export const APP_SIDEBAR_TOGGLE_GAP = 10
/** Space between the button box and the glyph drawn inside it: NavbarIcon centres an
 *  18px icon in 30px, and the icon's own artwork insets a further 3.5/24. Layout aligns
 *  to the glyph, since that is the edge the eye reads. */
export const APP_SIDEBAR_TOGGLE_GLYPH_INSET = 8

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
      {/* Same control as the conversation-pane toggle it sits above, so the two read as one family. */}
      <NavbarIcon tone="conversation" aria-label={label} aria-pressed={!isHidden} onClick={toggleSidebar}>
        <ToggleIcon />
      </NavbarIcon>
    </Tooltip>
  )
}
