import { createFileRoute } from '@tanstack/react-router'

import DocumentProcessingSettings from '@renderer/pages/settings/FileProcessingSettings/DocumentProcessingSettings'

export const Route = createFileRoute('/settings/file-processing')({
  component: DocumentProcessingSettings
})
