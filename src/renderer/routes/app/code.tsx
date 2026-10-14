import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

import CodeCliPage from '@renderer/pages/code/CodeCliPage'
import { CodeCli } from '@shared/types/codeCli'

export const Route = createFileRoute('/app/code')({
  validateSearch: (search) =>
    z.object({ tool: z.enum(CodeCli).optional().catch(undefined), id: z.string().optional() }).parse(search),
  component: CodeCliRoute
})

function CodeCliRoute() {
  return <CodeCliPage />
}
