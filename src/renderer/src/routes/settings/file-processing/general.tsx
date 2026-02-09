import GeneralSettings from '@renderer/pages/settings/FileProcessingSettings/components/GeneralSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/file-processing/general')({
  component: GeneralSettings
})
