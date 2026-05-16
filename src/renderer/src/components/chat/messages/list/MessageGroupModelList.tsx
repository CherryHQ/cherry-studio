import { RowFlex, Scrollbar, SegmentedControl, Tooltip } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import type { FC } from 'react'
import { memo, useCallback } from 'react'

import type { MessageListItem } from '../types'
import { getMessageListItemModel, isMessageListItemProcessing } from '../utils/messageListItem'

interface MessageGroupModelListProps {
  messages: MessageListItem[]
  selectMessageId: string
  setSelectedMessage: (message: MessageListItem) => void
}

const MessageGroupModelList: FC<MessageGroupModelListProps> = ({ messages, selectMessageId, setSelectedMessage }) => {
  const renderLabel = useCallback(
    (message: MessageListItem) => {
      const isProcessing = isMessageListItemProcessing(message)
      const isSelected = message.id === selectMessageId
      const model = getMessageListItemModel(message)
      const modelName = model?.name || model?.id
      const avatar = <ModelAvatar className={isProcessing ? 'animation-pulse' : ''} model={model} size={20} />

      return (
        <SegmentedLabel>
          {isSelected || !modelName ? (
            avatar
          ) : (
            <Tooltip content={modelName} delay={600}>
              {avatar}
            </Tooltip>
          )}
          {isSelected && <ModelName>{modelName}</ModelName>}
        </SegmentedLabel>
      )
    },
    [selectMessageId]
  )

  return (
    <Container>
      <ModelsContainer>
        <SegmentedControl
          className="[&_button]:h-6.5 [&_button]:gap-1 [&_button]:px-2"
          value={selectMessageId}
          onValueChange={(value) => {
            const message = messages.find((message) => message.id === value) as MessageListItem
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
        'flex flex-1 flex-row items-center justify-start overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

const SegmentedLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex items-center gap-[5px] py-0.5', className].filter(Boolean).join(' ')} {...props} />
)

const ModelName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={['font-medium text-xs', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageGroupModelList)
