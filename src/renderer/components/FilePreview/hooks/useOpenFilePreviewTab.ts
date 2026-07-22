import { useTabs } from '@renderer/hooks/tab'
import {
  createFilePreviewTabTarget,
  FILE_PREVIEW_REFRESH_KEY,
  getFilePreviewRefreshKey
} from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { useCallback } from 'react'

export function useOpenFilePreviewTab(): (filePath: FilePath, fileName?: string) => string {
  const { openTab, tabs, updateTab } = useTabs()

  return useCallback(
    (filePath: FilePath, fileName?: string) => {
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
