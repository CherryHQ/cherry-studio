import type { Tab } from '@renderer/store/tabs'

export const HOME_TAB_ID = 'home'
export const HOME_TAB_PATH = '/'

/**
 * 确保标签列表里一定存在 Home 标签页。
 * - 为了稳妥起见：如果缺失，则补到最前面。
 * - 如果已存在，则返回原数组引用，避免不必要的 rerender。
 */
export function ensureHomeTab(tabs: Tab[]): Tab[] {
  if (tabs.some((tab) => tab.id === HOME_TAB_ID)) {
    return tabs
  }

  return [{ id: HOME_TAB_ID, path: HOME_TAB_PATH }, ...tabs]
}

/**
 * 启动时恢复上次激活标签：
 * - 仅在初始路由为 `/` 时尝试跳转（避免覆盖深链路/启动参数导航）。
 */
export function getStartupRedirectPath(params: {
  currentPath: string
  tabs: Tab[]
  activeTabId: string
}): string | null {
  const { currentPath, tabs, activeTabId } = params

  if (currentPath !== HOME_TAB_PATH) return null
  if (!activeTabId || activeTabId === HOME_TAB_ID) return null

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  if (!activeTab?.path || activeTab.path === HOME_TAB_PATH) return null

  return activeTab.path
}
