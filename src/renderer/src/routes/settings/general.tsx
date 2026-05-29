import CommonSettings from '@renderer/pages/settings/CommonSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/general')({
  component: CommonSettings
})
