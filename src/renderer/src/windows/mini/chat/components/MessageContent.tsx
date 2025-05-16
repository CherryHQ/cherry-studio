import Markdown from '@renderer/pages/home/Markdown/Markdown'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: MainTextMessageBlock
}

const MessageContent: React.FC<Props> = ({ block }) => {
  return (
    <>
      {/* <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex> */}
      <Markdown block={block} />
    </>
  )
}

// const MentionTag = styled.span`
//   color: var(--color-link);
// `

export default React.memo(MessageContent)
