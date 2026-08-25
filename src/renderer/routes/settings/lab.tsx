import LabSettings from '@renderer/pages/settings/LabSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/lab')({
  component: LabSettings
})
