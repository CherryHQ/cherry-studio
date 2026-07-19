import SkillsSettings from '@renderer/pages/settings/SkillsSettings/SkillsSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/skills')({
  component: SkillsSettings
})
