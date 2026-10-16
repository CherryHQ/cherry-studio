import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

import { SkillDetails } from '@renderer/pages/settings/SkillDetails/SkillDetails'

// Receives the originating tab scope from the list so the back navigation can
// hand it back; absent when the detail route is opened directly.
const skillDetailsSearchSchema = z.object({
  scope: z.enum(['all', 'system', 'builtin']).optional()
})

export const Route = createFileRoute('/settings/skills/$skillId')({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = skillDetailsSearchSchema.safeParse(search)
    return parsed.success ? parsed.data : { scope: 'all' as const }
  },
  component: SkillDetailsRoute
})

function SkillDetailsRoute() {
  const { skillId } = Route.useParams()
  return <SkillDetails skillId={skillId} />
}
