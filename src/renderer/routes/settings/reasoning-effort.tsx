import { createFileRoute } from '@tanstack/react-router'

import ReasoningEffortMappingSettings from '@renderer/pages/settings/ReasoningEffortMappingSettings/ReasoningEffortMappingSettings'

export const Route = createFileRoute('/settings/reasoning-effort')({
  component: ReasoningEffortMappingSettings
})
