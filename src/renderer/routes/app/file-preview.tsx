import { createFileRoute } from '@tanstack/react-router'

import { FilePreviewPage } from '@renderer/pages/filePreview/FilePreviewPage'
import { parseFilePreviewRouteSearch } from '@renderer/utils/filePreview'

export const Route = createFileRoute('/app/file-preview')({
  validateSearch: (search) => parseFilePreviewRouteSearch(search),
  component: FilePreviewRoute
})

function FilePreviewRoute() {
  const { path } = Route.useSearch()
  return <FilePreviewPage filePath={path} />
}
