import FileProcessingSettings from '@renderer/pages/settings/FileProcessingSettings/FileProcessingSettings'
import { createFileRoute } from '@tanstack/react-router'

const DocumentProcessingSettings = () => <FileProcessingSettings feature="document_to_markdown" />

export const Route = createFileRoute('/settings/file-processing')({
  component: DocumentProcessingSettings
})
