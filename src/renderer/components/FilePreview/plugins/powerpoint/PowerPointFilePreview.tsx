import PptxPreviewPanel from '@renderer/components/ArtifactPreview/office/PptxPreviewPanel'

import type { FilePreviewPluginProps } from '../../types'

export default function PowerPointFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  return <PptxPreviewPanel filePath={filePath} fileName={fileName} refreshKey={refreshKey} />
}
