import WordPreviewPanel from '@renderer/components/ArtifactPreview/office/WordPreviewPanel'

import type { FilePreviewPluginProps } from '../../types'

export default function WordFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  return <WordPreviewPanel filePath={filePath} fileName={fileName} refreshKey={refreshKey} />
}
