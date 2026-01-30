import DocProcessSettings from '@renderer/pages/settings/DocProcessSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/docprocess')({
  component: DocProcessSettings
})
