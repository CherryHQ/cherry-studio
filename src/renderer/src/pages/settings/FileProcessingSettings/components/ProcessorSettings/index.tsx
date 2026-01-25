import { useFileProcessor } from '@renderer/hooks/useFileProcessors'
import { useParams } from '@tanstack/react-router'
import type { FC } from 'react'

import ApiProcessorSettings from './ApiProcessorSettings'
import BuiltinProcessorSettings from './BuiltinProcessorSettings'

const ProcessorSettings: FC = () => {
  const params = useParams({ strict: false }) as { processorId?: string }
  const processorId = params.processorId

  const { processor } = useFileProcessor(processorId || '')

  if (!processor || !processorId) {
    return null
  }

  if (processor.type === 'builtin') {
    return <BuiltinProcessorSettings processorId={processorId} />
  }

  return <ApiProcessorSettings processorId={processorId} />
}

export default ProcessorSettings
