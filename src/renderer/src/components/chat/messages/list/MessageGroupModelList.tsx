import { RowFlex, SegmentedControl } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import Scrollbar from '@renderer/components/Scrollbar'
import type { Model } from '@renderer/types'
import { AssistantMessageStatus, type Message } from '@renderer/types/newMessage'
import type { FC } from 'react'
import { memo, useCallback } from 'react'

interface MessageGroupModelListProps {
  messages: Message[]
  selectMessageId: string
  setSelectedMessage: (message: Message) => void
}

const MessageGroupModelList: FC<MessageGroupModelListProps> = ({ messages, selectMessageId, setSelectedMessage }) => {
  const isMessageProcessing = useCallback((message: Message) => {
    return [
      AssistantMessageStatus.PENDING,
      AssistantMessageStatus.PROCESSING,
      AssistantMessageStatus.SEARCHING
    ].includes(message.status as AssistantMessageStatus)
  }, [])

  const renderLabel = useCallback(
    (message: Message) => {
      const isProcessing = isMessageProcessing(message)
      const isSelected = message.id === selectMessageId

      return (
        <SegmentedLabel>
          <ModelAvatar className={isProcessing ? 'animation-pulse' : ''} model={message.model as Model} size={20} />
          {isSelected && <ModelName>{message.model?.name}</ModelName>}
        </SegmentedLabel>
      )
    },
    [isMessageProcessing, selectMessageId]
  )

  return (
    <Container>
      <ModelsContainer>
        <SegmentedControl
          value={selectMessageId}
          onValueChange={(value) => {
            const message = messages.find((message) => message.id === value) as Message
            setSelectedMessage(message)
          }}
          options={messages.map((message) => ({
            label: renderLabel(message),
            value: message.id
          }))}
          size="sm"
        />
      </ModelsContainer>
    </Container>
  )
}

const Container = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof RowFlex>) => (
  <RowFlex className={['ml-1 flex-1 items-center overflow-hidden', className].filter(Boolean).join(' ')} {...props} />
)

const ModelsContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Scrollbar>) => {
  return (
    <Scrollbar
      className={[
        'flex flex-1 flex-row items-center justify-start overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

const SegmentedLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex items-center gap-[5px] py-[3px]', className].filter(Boolean).join(' ')} {...props} />
)

const ModelName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={['font-medium text-xs', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageGroupModelList)
