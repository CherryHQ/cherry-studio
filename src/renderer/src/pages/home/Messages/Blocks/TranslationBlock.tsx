import type { TranslationMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

import MessageTranslate from '../MessageTranslate'

interface Props {
  block: TranslationMessageBlock
}

const TranslationBlock: React.FC<Props> = ({ block }) => {
  return <MessageTranslate block={block} />
}

export default React.memo(TranslationBlock)
