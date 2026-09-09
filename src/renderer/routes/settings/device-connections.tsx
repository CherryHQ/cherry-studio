import { DeviceConnectionsSettings } from '@renderer/pages/settings/DeviceConnectionsSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/device-connections')({
  component: DeviceConnectionsSettings
})
