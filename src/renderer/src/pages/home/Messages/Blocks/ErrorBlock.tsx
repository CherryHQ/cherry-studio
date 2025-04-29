import type { ErrorMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageError from '../MessageError'

interface Props {
  block: ErrorMessageBlock
}

const ErrorBlock: React.FC<Props> = ({ block }) => {
  return <MessageError block={block} />
}

export default React.memo(ErrorBlock)
