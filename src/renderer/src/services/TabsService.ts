import { loggerService } from '@logger'
import store from '@renderer/store'
import { removeTab, setActiveTab } from '@renderer/store/tabs'

import NavigationService from './NavigationService'

const logger = loggerService.withContext('TabsService')

class TabsService {
  /**
   * 关闭指定的标签页
   * @param tabId 要关闭的标签页ID
   * @returns 是否成功关闭
   */
  public closeTab(tabId: string): boolean {
    const state = store.getState()
    const tabs = state.tabs.tabs
    const activeTabId = state.tabs.activeTabId

    const tabToClose = tabs.find((tab) => tab.id === tabId)
    if (!tabToClose) {
      logger.warn(`Tab with id ${tabId} not found`)
      return false
    }

    // 如果只有一个标签页，不允许关闭
    if (tabs.length === 1) {
      logger.warn('Cannot close the last tab')
      return false
    }

    // 如果关闭的是当前激活的标签页，需要切换到其他标签页
    if (tabId === activeTabId) {
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId)
      const lastTab = remainingTabs[remainingTabs.length - 1]

      // 使用 NavigationService 导航到新的标签页
      if (NavigationService.navigate) {
        NavigationService.navigate(lastTab.path)
      } else {
        logger.error('Navigation service is not initialized')
        return false
      }
    }

    // 使用 Redux action 移除标签页
    store.dispatch(removeTab(tabId))

    logger.info(`Tab ${tabId} closed successfully`)
    return true
  }

  /**
   * 获取所有标签页
   */
  public getTabs() {
    return store.getState().tabs.tabs
  }

  /**
   * 获取当前激活的标签页ID
   */
  public getActiveTabId() {
    return store.getState().tabs.activeTabId
  }

  /**
   * 设置激活的标签页
   * @param tabId 标签页ID
   */
  public setActiveTab(tabId: string): boolean {
    const tabs = store.getState().tabs.tabs
    const tab = tabs.find((t) => t.id === tabId)

    if (!tab) {
      logger.warn(`Tab with id ${tabId} not found`)
      return false
    }

    store.dispatch(setActiveTab(tabId))

    // 导航到对应页面
    if (NavigationService.navigate) {
      NavigationService.navigate(tab.path)
    }

    return true
  }
}

export default new TabsService()
