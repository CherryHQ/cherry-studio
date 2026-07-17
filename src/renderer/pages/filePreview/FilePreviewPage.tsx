import { EmptyState } from '@cherrystudio/ui'
import { FilePreview } from '@renderer/components/FilePreview'
import { useCurrentTab } from '@renderer/hooks/tab'
import { getFilePreviewRefreshKey } from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { FileX2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FilePreviewPageProps {
  filePath?: FilePath
}

export function FilePreviewPage({ filePath }: FilePreviewPageProps) {
  const { t } = useTranslation()
  const currentTab = useCurrentTab()
  const refreshKey = getFilePreviewRefreshKey(currentTab?.metadata)

  if (filePath) return <FilePreview filePath={filePath} refreshKey={refreshKey} />

  return (
    <div className="flex h-full min-h-0 w-full bg-background text-foreground">
      <EmptyState
        icon={FileX2}
        title={t('file_preview.invalid_path.title')}
        description={t('file_preview.invalid_path.description')}
        className="h-full"
      />
    </div>
  )
}
