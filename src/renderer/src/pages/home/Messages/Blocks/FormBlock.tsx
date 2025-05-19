import WorkflowForm from '@renderer/components/Dify/WorkflowForm'
import { FormMessageBlock, Message } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: FormMessageBlock
  message: Message
}

const FormBlock: React.FC<Props> = ({ block, message }) => {
  return <WorkflowForm block={block} message={message} />
}

export default React.memo(FormBlock)
