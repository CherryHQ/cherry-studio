import { createFileRoute } from '@tanstack/react-router'

import LabSettings from '@renderer/pages/settings/LabSettings'

export const Route = createFileRoute('/settings/lab')({
  component: LabSettings
})
