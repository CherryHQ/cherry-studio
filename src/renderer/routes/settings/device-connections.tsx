import { createFileRoute } from '@tanstack/react-router'

import { DeviceConnectionsSettings } from '@renderer/pages/settings/DeviceConnectionsSettings'

export const Route = createFileRoute('/settings/device-connections')({
  component: DeviceConnectionsSettings
})
