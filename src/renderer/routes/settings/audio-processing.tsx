import { createFileRoute } from '@tanstack/react-router'

import AudioProcessingSettings from '@renderer/pages/settings/FileProcessingSettings/AudioProcessingSettings'

export const Route = createFileRoute('/settings/audio-processing')({
  component: AudioProcessingSettings
})
