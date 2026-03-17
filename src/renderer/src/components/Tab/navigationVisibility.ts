import type { SidebarIcon } from '@renderer/types'

const TAB_TO_SIDEBAR_ICON: Partial<Record<string, SidebarIcon>> = {
  home: 'assistants',
  agents: 'agents',
  store: 'store',
  paintings: 'paintings',
  translate: 'translate',
  apps: 'minapp',
  knowledge: 'knowledge',
  files: 'files',
  notes: 'notes',
  code: 'code_tools',
  openclaw: 'openclaw'
}

export const isNavbarTabVisible = (tabId: string, visibleIcons: SidebarIcon[]): boolean => {
  const sidebarIcon = TAB_TO_SIDEBAR_ICON[tabId]
  if (!sidebarIcon) {
    return true
  }

  return visibleIcons.includes(sidebarIcon)
}
