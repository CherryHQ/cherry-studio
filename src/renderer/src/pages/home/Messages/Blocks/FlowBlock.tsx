import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { Workflow } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { FlowMessageBlock, Message, MessageBlockStatus } from '@renderer/types/newMessage'
import { Typography } from 'antd'
import { Bot, Check, House, LandPlot, X } from 'lucide-react'
import React from 'react'
import styled from 'styled-components'

interface Props {
  block: FlowMessageBlock
  message: Message
}

// 根据类型获取图标
const getTypeIcon = (type?: string) => {
  switch (type) {
    case 'start':
      return <House size={16} />
    case 'llm':
      return <Bot size={16} />
    // 添加更多类型及其对应的图标
    case 'end':
      return <LandPlot size={16} />
    default:
      return null
  }
}

// 根据状态获取图标
const getStatusIcon = (status?: MessageBlockStatus) => {
  switch (status) {
    case MessageBlockStatus.PROCESSING:
      return <SvgSpinners180Ring height={16} width={16} />
    case MessageBlockStatus.SUCCESS:
      return <Check style={{ color: 'green' }} size={16} />
    case MessageBlockStatus.ERROR:
      return <X style={{ color: 'red' }} size={16} />
    default:
      return null // 或者一个默认图标
  }
}

const FlowBlock: React.FC<Props> = ({ block, message }) => {
  console.log('FlowBlock', block)
  const renderBlockContent = () => {
    switch (block.chunkType) {
      case ChunkType.WORKFLOW_INIT:
        return <WorkflowForm workflow={block.workflow as Workflow} message={message} />
      default: {
        const typeIcon = getTypeIcon(block.metadata?.type)
        const statusIcon = getStatusIcon(block.status)
        const title = block.metadata?.title || '未知节点'

        return (
          <Container>
            {typeIcon}
            <Typography.Text>{title}</Typography.Text>
            {statusIcon}
          </Container>
        )
      }
    }
  }

  return <div>{renderBlockContent()}</div>
}

const Container = styled.div`
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  gap: 8px;
  padding: 8px;
`

export default React.memo(FlowBlock)
