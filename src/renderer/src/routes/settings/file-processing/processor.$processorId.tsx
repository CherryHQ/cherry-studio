import ProcessorSettings from '@renderer/pages/settings/FileProcessingSettings/components/ProcessorSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/file-processing/processor/$processorId')({
  component: ProcessorSettings
})
