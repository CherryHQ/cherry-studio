import { createFileRoute } from '@tanstack/react-router'

import { SkillsSettings } from '@renderer/pages/settings/SkillsSettings'

export const Route = createFileRoute('/settings/skills')({
  component: SkillsSettings
})
