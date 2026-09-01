import { createFileRoute } from '@tanstack/react-router'

import { PromptSettings } from '@renderer/pages/settings/PromptSettings'

export const Route = createFileRoute('/settings/prompts')({
  component: PromptSettings
})
