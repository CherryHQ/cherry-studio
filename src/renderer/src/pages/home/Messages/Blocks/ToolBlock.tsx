import type { ToolMessageBlock } from '@renderer/types/newMessage'
import React from 'react'
import styled from 'styled-components'

import MessageTools from '../Tools/MessageTools'

interface Props {
  block: ToolMessageBlock
}

const ToolBlock: React.FC<Props> = ({ block }) => {
  return (
    <ToolBlockContainer>
      <MessageTools block={block} />
    </ToolBlockContainer>
  )
}

const ToolBlockContainer = styled.div`
  width: 100%;
  max-width: 100%;
`

export default React.memo(ToolBlock)
