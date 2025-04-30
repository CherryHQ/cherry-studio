import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { Flex, Tooltip } from 'antd'
import React, { useCallback } from 'react'
import styled from 'styled-components'

import MessageBlockRenderer from './Blocks'
interface Props {
  message: Message
  model?: Model
}

const MessageContent: React.FC<Props> = ({ message, model }) => {
  // const { t } = useTranslation()
  // if (message.status === 'pending') {
  //   return (

  //   )
  // }

  const renderMentions = useCallback(() => {
    return (
      <Flex gap="8px" wrap style={{ marginBottom: 10 }}>
        {message.mentions?.map((asst) => {
          const key = `${asst.id}-${getModelUniqId(asst.model)}`
          return (
            <Tooltip title={`${asst.emoji} ${asst.name}`} key={key} mouseEnterDelay={0.5}>
              <MentionTag key={key}>{'@' + asst.model.name}</MentionTag>
            </Tooltip>
          )
        })}
      </Flex>
    )
  }, [message.mentions])

  // if (message.status === 'searching') {
  //   return (
  //     <SearchingContainer>
  //       <Search size={24} />
  //       <SearchingText>{t('message.searching')}</SearchingText>
  //       <BarLoader color="#1677ff" />
  //     </SearchingContainer>
  //   )
  // }

  // if (message.status === 'error') {
  //   return <MessageError message={message} />
  // }

  // if (message.type === '@' && model) {
  //   const content = `[@${model.name}](#)  ${getBriefInfo(message.content)}`
  //   return <Markdown message={{ ...message, content }} />
  // }
  // const toolUseRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g

  // console.log('message', message)

  return (
    <>
      {renderMentions()}
      <MessageBlockRenderer blocks={message.blocks} model={model} message={message} />
    </>
  )
}

// const SearchingContainer = styled.div`
//   display: flex;
//   flex-direction: row;
//   align-items: center;
//   background-color: var(--color-background-mute);
//   padding: 10px;
//   border-radius: 10px;
//   margin-bottom: 10px;
//   gap: 10px;
// `

const MentionTag = styled.span`
  color: var(--color-link);
`

// const SearchingText = styled.div`
//   font-size: 14px;
//   line-height: 1.6;
//   text-decoration: none;
//   color: var(--color-text-1);
// `

export default React.memo(MessageContent)
