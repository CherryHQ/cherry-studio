import { type TabsContextValue, useOptionalTabsContext, useTabs } from '@renderer/hooks/tab'
import {
  createFilePreviewTabTarget,
  FILE_PREVIEW_REFRESH_KEY,
  getFilePreviewRefreshKey
} from '@renderer/utils/filePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { useCallback } from 'react'

type OpenFilePreviewTab = (filePath: AbsoluteFilePath, fileName?: string) => string
type FilePreviewTabsContext = Pick<TabsContextValue, 'openTab' | 'tabs' | 'updateTab'>

function useOpenFilePreviewTabFromContext(tabsContext: FilePreviewTabsContext | null): OpenFilePreviewTab {
  const openTab = tabsContext?.openTab
  const tabs = tabsContext?.tabs
  const updateTab = tabsContext?.updateTab

  return useCallback(
    (filePath: AbsoluteFilePath, fileName?: string) => {
      if (!openTab || !tabs || !updateTab) throw new Error('File preview tabs are unavailable')

      const target = createFilePreviewTabTarget(filePath)
      const title = fileName || target.title
      const existingTab = tabs.find((tab) => tab.type === 'route' && tab.url === target.url)

      if (existingTab) {
        const tabId = openTab(target.url, { title })
        updateTab(tabId, {
          metadata: {
            ...existingTab.metadata,
            [FILE_PREVIEW_REFRESH_KEY]: getFilePreviewRefreshKey(existingTab.metadata) + 1
          }
        })
        return tabId
      }

      return openTab(target.url, {
        title,
        metadata: { [FILE_PREVIEW_REFRESH_KEY]: 0 }
      })
    },
    [openTab, tabs, updateTab]
  )
}

export function useOpenFilePreviewTab(): OpenFilePreviewTab {
  return useOpenFilePreviewTabFromContext(useTabs())
}

export function useOptionalOpenFilePreviewTab(): OpenFilePreviewTab | undefined {
  const tabsContext = useOptionalTabsContext()
  const openFilePreviewTab = useOpenFilePreviewTabFromContext(tabsContext)
  return tabsContext ? openFilePreviewTab : undefined
}
