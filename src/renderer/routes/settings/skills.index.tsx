import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

import { SkillsSettings } from '@renderer/pages/settings/SkillsSettings'

// Keeps the active tab (all/system/builtin) in the URL so that returning from
// the detail route restores the tab the user was browsing instead of resetting to "all".
const skillsIndexSearchSchema = z.object({
  scope: z.enum(['all', 'system', 'builtin']).optional()
})

export const Route = createFileRoute('/settings/skills/')({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = skillsIndexSearchSchema.safeParse(search)
    return parsed.success ? parsed.data : {}
  },
  component: SkillsSettings
})
