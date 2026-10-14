import { createFileRoute } from '@tanstack/react-router'

import OcrSettings from '@renderer/pages/settings/FileProcessingSettings/OcrSettings'

export const Route = createFileRoute('/settings/ocr')({
  component: OcrSettings
})
