import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const skillsSettingsSearchSchema = z.object({ id: z.string().optional() })

import { SkillsSettings } from '@renderer/pages/settings/SkillsSettings'

export const Route = createFileRoute('/settings/skills')({
  validateSearch: (search) => skillsSettingsSearchSchema.parse(search),
  component: SkillsSettings
})
