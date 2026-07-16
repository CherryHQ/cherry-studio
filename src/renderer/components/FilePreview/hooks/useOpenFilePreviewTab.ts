import { useTabs } from '@renderer/hooks/tab'
import {
  createFilePreviewTabTarget,
  FILE_PREVIEW_REFRESH_KEY,
  getFilePreviewRefreshKey
} from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { useCallback } from 'react'

export function useOpenFilePreviewTab(): (filePath: FilePath) => string {
  const { openTab, tabs, updateTab } = useTabs()

  return useCallback(
    (filePath: FilePath) => {
      const target = createFilePreviewTabTarget(filePath)
      const existingTab = tabs.find((tab) => tab.type === 'route' && tab.url === target.url)

      if (existingTab) {
        const tabId = openTab(target.url, { title: target.title })
        updateTab(tabId, {
          metadata: {
            ...existingTab.metadata,
            [FILE_PREVIEW_REFRESH_KEY]: getFilePreviewRefreshKey(existingTab.metadata) + 1
          }
        })
        return tabId
      }

      return openTab(target.url, {
        title: target.title,
        metadata: { [FILE_PREVIEW_REFRESH_KEY]: 0 }
      })
    },
    [openTab, tabs, updateTab]
  )
}
