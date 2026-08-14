import CodeCliPage from '@renderer/pages/code/CodeCliPage'
import { CodeCli } from '@shared/types/codeCli'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

export const Route = createFileRoute('/app/code')({
  validateSearch: (search) => z.object({ tool: z.enum(CodeCli).optional() }).parse(search),
  component: CodeCliRoute
})

function CodeCliRoute() {
  const { tool } = Route.useSearch()
  return <CodeCliPage initialTool={tool} />
}
