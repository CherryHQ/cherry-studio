import Scrollbar from '@renderer/components/Scrollbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { MultiModelMessageStyle } from '@renderer/store/settings'
import { Message, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Popover } from 'antd'
import { Dispatch, FC, memo, SetStateAction, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import MessageItem from './Message'
import MessageGroupMenuBar from './MessageGroupMenuBar'

interface Props {
  messages: (Message & { index: number })[]
  topic?: Topic
  hidePresetMessages?: boolean
  onGetMessages?: () => Message[]
  onSetMessages?: Dispatch<SetStateAction<Message[]>>
  onDeleteMessage?: (message: Message) => Promise<void>
  onDeleteGroupMessages?: (askId: string) => Promise<void>
}

const MessageGroup: FC<Props> = ({
  messages,
  topic,
  hidePresetMessages,
  onDeleteMessage,
  onSetMessages,
  onGetMessages,
  onDeleteGroupMessages
}) => {
  const { multiModelMessageStyle: multiModelMessageStyleSetting, gridColumns, gridPopoverTrigger } = useSettings()
  const { t } = useTranslation()

  const [multiModelMessageStyle, setMultiModelMessageStyle] =
    useState<MultiModelMessageStyle>(multiModelMessageStyleSetting)

  const messageLength = messages.length
  const [selectedIndex, setSelectedIndex] = useState(messageLength - 1)

  const isGrouped = messageLength > 1
  const isHorizontal = multiModelMessageStyle === 'horizontal'
  const isGrid = multiModelMessageStyle === 'grid'

  const onDelete = useCallback(async () => {
    window.modal.confirm({
      title: t('message.group.delete.title'),
      content: t('message.group.delete.content'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      okText: t('common.delete'),
      onOk: () => {
        const askId = messages[0].askId
        askId && onDeleteGroupMessages?.(askId)
      }
    })
  }, [messages, onDeleteGroupMessages, t])

  useEffect(() => {
    setSelectedIndex(messageLength - 1)
  }, [messageLength])

  return (
    <GroupContainer
      $isGrouped={isGrouped}
      $layout={multiModelMessageStyle}
      className={classNames([isGrouped && 'group-container', isHorizontal && 'horizontal', isGrid && 'grid'])}>
      <GridContainer
        $count={messageLength}
        $layout={multiModelMessageStyle}
        $gridColumns={gridColumns}
        className={classNames([isGrouped && 'group-grid-container', isHorizontal && 'horizontal', isGrid && 'grid'])}>
        {messages.map((message, index) => {
          const isGridGroupMessage = isGrid && message.role === 'assistant' && isGrouped
          if (isGridGroupMessage) {
            return (
              <Popover
                content={
                  <MessageWrapper
                    $layout={multiModelMessageStyle}
                    $selected={index === selectedIndex}
                    $isGrouped={isGrouped}
                    $isInPopover={true}
                    key={message.id}>
                    <MessageItem
                      isGrouped={isGrouped}
                      message={message}
                      topic={topic}
                      index={message.index}
                      hidePresetMessages={hidePresetMessages}
                      style={{
                        paddingTop: isGrouped && ['horizontal', 'grid'].includes(multiModelMessageStyle) ? 0 : 15
                      }}
                      onSetMessages={onSetMessages}
                      onDeleteMessage={onDeleteMessage}
                      onGetMessages={onGetMessages}
                    />
                  </MessageWrapper>
                }
                trigger={gridPopoverTrigger}
                styles={{ root: { maxWidth: '60vw', minWidth: '550px', overflowY: 'auto', zIndex: 1000 } }}
                getPopupContainer={(triggerNode) => triggerNode.parentNode as HTMLElement}
                key={message.id}>
                <MessageWrapper
                  $layout={multiModelMessageStyle}
                  $selected={index === selectedIndex}
                  $isGrouped={isGrouped}
                  key={message.id}>
                  <MessageItem
                    isGrouped={isGrouped}
                    message={message}
                    topic={topic}
                    index={message.index}
                    hidePresetMessages={hidePresetMessages}
                    style={
                      gridPopoverTrigger === 'hover' && isGrouped
                        ? {
                            paddingTop: isGrouped && ['horizontal', 'grid'].includes(multiModelMessageStyle) ? 0 : 15,
                            overflow: isGrouped ? 'hidden' : 'auto',
                            maxHeight: isGrouped ? '280px' : 'unset'
                          }
                        : undefined
                    }
                    onSetMessages={onSetMessages}
                    onDeleteMessage={onDeleteMessage}
                    onGetMessages={onGetMessages}
                  />
                </MessageWrapper>
              </Popover>
            )
          }
          return (
            <MessageWrapper
              $layout={multiModelMessageStyle}
              $selected={index === selectedIndex}
              $isGrouped={isGrouped}
              key={message.id}
              className={message.role === 'assistant' && isHorizontal && isGrouped ? 'group-message-wrapper' : ''}>
              <MessageItem
                isGrouped={isGrouped}
                message={message}
                topic={topic}
                index={message.index}
                hidePresetMessages={hidePresetMessages}
                style={{ paddingTop: isGrouped && ['horizontal', 'grid'].includes(multiModelMessageStyle) ? 0 : 15 }}
                onSetMessages={onSetMessages}
                onDeleteMessage={onDeleteMessage}
                onGetMessages={onGetMessages}
              />
            </MessageWrapper>
          )
        })}
      </GridContainer>
      {isGrouped && (
        <MessageGroupMenuBar
          multiModelMessageStyle={multiModelMessageStyle}
          setMultiModelMessageStyle={setMultiModelMessageStyle}
          messages={messages}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          onDelete={onDelete}
        />
      )}
    </GroupContainer>
  )
}

const GroupContainer = styled.div<{ $isGrouped: boolean; $layout: MultiModelMessageStyle }>`
  padding-top: ${({ $isGrouped, $layout }) => ($isGrouped && 'horizontal' === $layout ? '15px' : '0')};
  &.group-container.horizontal,
  &.group-container.grid {
    padding: 0 20px;
    .message {
      padding: 0;
    }
    .group-menu-bar {
      margin-left: 0;
      margin-right: 0;
    }
  }
`

const GridContainer = styled.div<{ $count: number; $layout: MultiModelMessageStyle; $gridColumns: number }>`
  width: 100%;
  display: grid;
  gap: ${({ $layout }) => ($layout === 'horizontal' ? '16px' : '0')};
  overflow-y: auto;
  grid-template-columns: repeat(
    ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
    minmax(550px, 1fr)
  );
  @media (max-width: 800px) {
    grid-template-columns: repeat(
      ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
      minmax(400px, 1fr)
    );
  }
  ${({ $layout }) =>
    $layout === 'horizontal' &&
    css`
      margin-top: 15px;
    `}
  ${({ $gridColumns, $layout, $count }) =>
    $layout === 'grid' &&
    css`
      margin-top: 15px;
      grid-template-columns: repeat(${$count > 1 ? $gridColumns || 2 : 1}, minmax(0, 1fr));
      grid-template-rows: auto;
      gap: 16px;
    `}
`

interface MessageWrapperProps {
  $layout: 'fold' | 'horizontal' | 'vertical' | 'grid'
  $selected: boolean
  $isGrouped: boolean
  $isInPopover?: boolean
}

const MessageWrapper = styled(Scrollbar)<MessageWrapperProps>`
  width: 100%;
  display: ${(props) => {
    if (props.$layout === 'fold') {
      return props.$selected ? 'block' : 'none'
    }
    if (props.$layout === 'horizontal') {
      return 'inline-block'
    }
    return 'block'
  }};

  ${({ $layout, $isGrouped }) => {
    if ($layout === 'horizontal' && $isGrouped) {
      return css`
        border: 0.5px solid var(--color-border);
        padding: 10px;
        border-radius: 6px;
        max-height: 600px;
        margin-bottom: 10px;
      `
    }
    return ''
  }}

  ${({ $layout, $isInPopover, $isGrouped }) => {
    return $layout === 'grid' && $isGrouped
      ? css`
          max-height: ${$isInPopover ? '50vh' : '300px'};
          overflow-y: ${$isInPopover ? 'auto' : 'hidden'};
          border: 0.5px solid ${$isInPopover ? 'transparent' : 'var(--color-border)'};
          padding: 10px;
          border-radius: 6px;
          background-color: var(--color-background);
        `
      : css`
          overflow-y: auto;
          border-radius: 6px;
        `
  }}
`

export default memo(MessageGroup)
