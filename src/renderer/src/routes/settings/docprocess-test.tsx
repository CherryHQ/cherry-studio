import DocProcessTestSettings from '@renderer/pages/settings/DocProcessTestSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/docprocess-test')({
  component: DocProcessTestSettings
})
