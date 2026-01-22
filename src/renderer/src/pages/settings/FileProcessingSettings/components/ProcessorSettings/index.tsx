import { useFileProcessor } from '@renderer/hooks/useFileProcessors'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import ApiProcessorSettings from './ApiProcessorSettings'
import BuiltinProcessorSettings from './BuiltinProcessorSettings'

const ProcessorSettings: FC = () => {
  const params = useParams({ strict: false }) as { processorId?: string }
  const processorId = params.processorId

  const { processor, updateConfig } = useFileProcessor(processorId || '')

  if (!processor || !processorId) {
    return null
  }

  // Conditional rendering based on processor type
  if (processor.type === 'builtin') {
    return <BuiltinProcessorSettings processor={processor} updateConfig={updateConfig} />
  }

  return <ApiProcessorSettings processor={processor} updateConfig={updateConfig} />
}

export default ProcessorSettings
