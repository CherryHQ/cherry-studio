import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/model')({
  component: ModelSettings
})
