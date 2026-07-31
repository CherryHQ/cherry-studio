import { createFileRoute } from '@tanstack/react-router'

import ChannelsSettings from '@renderer/pages/settings/ChannelsSettings/ChannelsSettings'

export const Route = createFileRoute('/settings/channels')({
  component: ChannelsSettings
})
