import KnowledgePage from '@renderer/pages/knowledge/KnowledgePage'
import { parseKnowledgeRouteSearch } from '@renderer/pages/knowledge/routeSearch'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

export const Route = createFileRoute('/app/knowledge')({
  validateSearch: (search) => parseKnowledgeRouteSearch(search),
  component: KnowledgeRoute
})

function KnowledgeRoute() {
  const { baseId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleBaseIdChange = useCallback(
    (nextBaseId?: string) => void navigate({ search: nextBaseId ? { baseId: nextBaseId } : {}, replace: true }),
    [navigate]
  )
  return <KnowledgePage baseId={baseId} onBaseIdChange={handleBaseIdChange} />
}
