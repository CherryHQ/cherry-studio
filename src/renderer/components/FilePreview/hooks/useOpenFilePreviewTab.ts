import { useTabs } from '@renderer/hooks/tab'
import { createFilePreviewTabTarget } from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { useCallback } from 'react'

export function useOpenFilePreviewTab(): (filePath: FilePath) => string {
  const { openTab } = useTabs()

  return useCallback(
    (filePath: FilePath) => {
      const target = createFilePreviewTabTarget(filePath)
      return openTab(target.url, { title: target.title })
    },
    [openTab]
  )
}
