import PromptSettings from '@renderer/pages/settings/PromptSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/prompts')({
  component: PromptSettings
})
