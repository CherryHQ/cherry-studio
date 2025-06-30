import DeepResearchCard from '@renderer/components/DeepResearchCard'
import type { DeepResearchMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: DeepResearchMessageBlock
}

const DeepResearchBlock: React.FC<Props> = ({ block }) => {
  return <DeepResearchCard block={block} />
}

export default React.memo(DeepResearchBlock)
