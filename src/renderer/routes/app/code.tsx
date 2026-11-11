import { createFileRoute, redirect } from '@tanstack/react-router'
import * as z from 'zod'

import { CodeCli } from '@shared/types/codeCli'

export const Route = createFileRoute('/app/code')({
  validateSearch: (search) =>
    z.object({ tool: z.enum(CodeCli).optional().catch(undefined), id: z.string().optional() }).parse(search),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings/local-agents', search, replace: true })
  }
})
