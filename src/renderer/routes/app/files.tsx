import FilesPage from '@renderer/pages/files/FilesPage'
import { parseFilesRouteSearch } from '@renderer/pages/files/routeSearch'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

export const Route = createFileRoute('/app/files')({
  validateSearch: (search) => parseFilesRouteSearch(search),
  component: FilesRoute
})

function FilesRoute() {
  const { entryId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleEntryIdChange = useCallback(
    (nextEntryId?: string) => void navigate({ search: nextEntryId ? { entryId: nextEntryId } : {}, replace: true }),
    [navigate]
  )
  return <FilesPage entryId={entryId} onEntryIdChange={handleEntryIdChange} />
}
