import ComponentLabSettings from '@renderer/pages/settings/ComponentLabSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/component-lab')({
  component: ComponentLabSettings
})
