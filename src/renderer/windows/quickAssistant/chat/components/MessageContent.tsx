import type { MarkdownSource } from '@cherrystudio/ui/composites/markdown'
import ChatMarkdown from '@renderer/components/chat/messages/markdown/ChatMarkdown'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import React from 'react'

interface Props {
  block: MainTextMessageBlock
}

const MessageContent: React.FC<Props> = ({ block }) => {
  const markdownSource: MarkdownSource = {
    id: block.id,
    content: block.content,
    status: String(block.status).toLowerCase() as MarkdownSource['status']
  }

  return (
    <>
      {/* <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((model) => <MentionTag key={getModelUniqId(model)}>{'@' + model.name}</MentionTag>)}
      </Flex> */}
      <ChatMarkdown block={markdownSource} />
    </>
  )
}

// const MentionTag = styled.span`
//   color: var(--color-link);
// `

export default React.memo(MessageContent)
