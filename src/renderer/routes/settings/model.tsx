import { createFileRoute } from '@tanstack/react-router'

import ModelSettings from '@renderer/pages/settings/ModelSettings/ModelSettings'

export const Route = createFileRoute('/settings/model')({
  component: ModelSettings
})
