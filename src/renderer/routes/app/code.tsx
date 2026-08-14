import CodeCliPage from '@renderer/pages/code/CodeCliPage'
import { CodeCli } from '@shared/types/codeCli'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'
import * as z from 'zod'

export const Route = createFileRoute('/app/code')({
  validateSearch: (search) => z.object({ tool: z.enum(CodeCli).optional() }).parse(search),
  component: CodeCliRoute
})

function CodeCliRoute() {
  const { tool } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleToolChange = useCallback(
    (selectedTool: CodeCli) => void navigate({ search: { tool: selectedTool }, replace: true }),
    [navigate]
  )
  return <CodeCliPage initialTool={tool} onToolChange={handleToolChange} />
}
