import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { Workflow } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { FlowMessageBlock, Message, MessageBlockStatus } from '@renderer/types/newMessage'
import { StepProps, Steps } from 'antd'
import { Bot, House, LandPlot, Wrench } from 'lucide-react'
import React from 'react'

interface Props {
  block: FlowMessageBlock
  message: Message
}

// 根据类型获取图标
const getTypeIcon = (status: MessageBlockStatus, type?: string) => {
  if (status === MessageBlockStatus.PROCESSING) {
    return <SvgSpinners180Ring height={16} width={16} />
  }
  switch (type) {
    case 'start':
      return <House size={16} />
    case 'llm':
      return <Bot size={16} />
    case 'end':
    case 'answer':
      return <LandPlot size={16} />
    default:
      return <Wrench size={16} />
  }
}

const FlowBlock: React.FC<Props> = ({ block, message }) => {
  const nodeItems: StepProps[] =
    block.nodes?.map((node) => {
      const typeIcon = getTypeIcon(node.status, node.type)
      const title = node?.title || 'UNKNOWN'
      return {
        title: title,
        icon: typeIcon
      }
    }) ?? []
  console.log('nodeItems', nodeItems)
  const renderBlockContent = () => {
    switch (block.chunkType) {
      case ChunkType.WORKFLOW_INIT:
        return <WorkflowForm workflow={block.workflow as Workflow} message={message} />
      default: {
        return <Steps items={nodeItems} />
      }
    }
  }

  return <div>{renderBlockContent()}</div>
}

export default React.memo(FlowBlock)
