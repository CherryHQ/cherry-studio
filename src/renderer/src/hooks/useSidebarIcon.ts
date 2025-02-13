import { SidebarIcon } from '@renderer/types'

import { useSettings } from './useSettings'

export function useSidebarIconShow(icon: SidebarIcon) {
  const { sidebarIcons } = useSettings()
  return sidebarIcons.visible.includes(icon)
}
