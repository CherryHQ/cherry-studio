import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import { Workflow } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import type { FlowMessageBlock, Message } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: FlowMessageBlock
  message: Message
}

const FlowBlock: React.FC<Props> = ({ block, message }) => {
  console.log('FlowBlock', block)
  const renderBlockContent = () => {
    switch (block.chunkType) {
      case ChunkType.WORKFLOW_INIT:
        return <WorkflowForm workflow={block.workflow as Workflow} message={message} />
      default:
        return <div>{block.chunkType}</div>
    }
  }

  return <div>{renderBlockContent()}</div>
}

export default React.memo(FlowBlock)
