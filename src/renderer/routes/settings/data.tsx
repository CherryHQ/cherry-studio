import { createFileRoute } from '@tanstack/react-router'

import DataSettings from '@renderer/pages/settings/DataSettings/DataSettings'

export const Route = createFileRoute('/settings/data')({
  component: DataSettings
})
