import OcrSettings from '@renderer/pages/settings/FileProcessingSettings/OcrSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/ocr')({
  component: OcrSettings
})
