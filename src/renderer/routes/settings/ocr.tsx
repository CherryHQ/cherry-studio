import FileProcessingSettings from '@renderer/pages/settings/FileProcessingSettings/FileProcessingSettings'
import { createFileRoute } from '@tanstack/react-router'

const OcrSettings = () => <FileProcessingSettings feature="image_to_text" />

export const Route = createFileRoute('/settings/ocr')({
  component: OcrSettings
})
