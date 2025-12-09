import DataSettings from '@renderer/pages/settings/DataSettings/DataSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/data')({
  component: DataSettings
})
