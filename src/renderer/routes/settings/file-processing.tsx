import DocumentProcessingSettings from '@renderer/pages/settings/FileProcessingSettings/DocumentProcessingSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/file-processing')({
  component: DocumentProcessingSettings
})
