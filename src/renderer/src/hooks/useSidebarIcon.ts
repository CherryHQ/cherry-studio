import { usePreference } from '@data/hooks/usePreference'
import { SidebarIcon } from '@shared/data/preferenceTypes'

export function useSidebarIconShow(icon: SidebarIcon) {
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  return visibleSidebarIcons.includes(icon)
}
