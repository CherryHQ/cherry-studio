import FileProcessingSettings from '@renderer/pages/settings/FileProcessingSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/file-processing')({
  component: FileProcessingSettings
})
