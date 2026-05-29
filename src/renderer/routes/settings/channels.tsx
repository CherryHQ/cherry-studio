import ChannelsSettings from '@renderer/pages/settings/ChannelsSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/channels')({
  component: ChannelsSettings
})
