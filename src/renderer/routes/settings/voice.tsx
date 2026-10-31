import { createFileRoute } from '@tanstack/react-router'

import { VoiceSettings } from '@renderer/pages/settings/VoiceSettings'

export const Route = createFileRoute('/settings/voice')({
  component: VoiceSettings
})
