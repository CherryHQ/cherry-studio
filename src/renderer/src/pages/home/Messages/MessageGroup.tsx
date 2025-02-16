import {
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  FolderOutlined,
  NumberOutlined
} from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { MultiModelMessageStyle } from '@renderer/store/settings'
import { Message, Model, Topic } from '@renderer/types'
import { Button, Popover, Segmented as AntdSegmented } from 'antd'
import { Dispatch, FC, SetStateAction, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import MessageItem from './Message'

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

  const onDelete = async () => {
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
  }

  useEffect(() => {
    setSelectedIndex(messageLength - 1)
  }, [messageLength])

  const isHorizontal = multiModelMessageStyle === 'horizontal'

  return (
    <GroupContainer $isGrouped={isGrouped} $layout={multiModelMessageStyle}>
      <GridContainer $count={messageLength} $layout={multiModelMessageStyle} $gridColumns={gridColumns}>
        {messages.map((message, index) =>
          multiModelMessageStyle === 'grid' && message.role === 'assistant' && isGrouped ? (
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
          ) : (
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
        )}
      </GridContainer>
      {isGrouped && (
        <GroupMenuBar className="group-menu-bar" $layout={multiModelMessageStyle}>
          <HStack style={{ alignItems: 'center', flex: 1, overflow: 'hidden' }}>
            <LayoutContainer>
              {['fold', 'vertical', 'horizontal', 'grid'].map((layout) => (
                <LayoutOption
                  key={layout}
                  active={multiModelMessageStyle === layout}
                  onClick={() => setMultiModelMessageStyle(layout as MultiModelMessageStyle)}>
                  {layout === 'fold' ? (
                    <FolderOutlined />
                  ) : layout === 'horizontal' ? (
                    <ColumnWidthOutlined />
                  ) : layout === 'vertical' ? (
                    <ColumnHeightOutlined />
                  ) : (
                    <NumberOutlined />
                  )}
                </LayoutOption>
              ))}
            </LayoutContainer>
            {multiModelMessageStyle === 'fold' && (
              <ModelsContainer>
                <Segmented
                  value={selectedIndex.toString()}
                  onChange={(value) => {
                    setSelectedIndex(Number(value))
                    EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messages[Number(value)].id, false)
                  }}
                  options={messages.map((message, index) => ({
                    label: (
                      <SegmentedLabel>
                        <ModelAvatar model={message.model as Model} size={20} />
                        <ModelName>{message.model?.name}</ModelName>
                      </SegmentedLabel>
                    ),
                    value: index.toString()
                  }))}
                  size="small"
                />
              </ModelsContainer>
            )}
          </HStack>
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined style={{ color: 'var(--color-error)' }} />}
            onClick={onDelete}
          />
        </GroupMenuBar>
      )}
    </GroupContainer>
  )
}

const GroupContainer = styled.div<{ $isGrouped: boolean; $layout: MultiModelMessageStyle }>`
  padding-top: ${({ $isGrouped, $layout }) => ($isGrouped && 'horizontal' === $layout ? '15px' : '0')};
`

const GridContainer = styled.div<{ $count: number; $layout: MultiModelMessageStyle; $gridColumns: number }>`
  width: 100%;
  display: grid;
  grid-template-columns: repeat(
    ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
    minmax(550px, 1fr)
  );
  gap: ${({ $layout }) => ($layout === 'horizontal' ? '16px' : '0')};
  @media (max-width: 800px) {
    grid-template-columns: repeat(
      ${({ $layout, $count }) => (['fold', 'vertical'].includes($layout) ? 1 : $count)},
      minmax(400px, 1fr)
    );
  }
  overflow-y: auto;
  ${({ $gridColumns, $layout, $count }) =>
    $layout === 'grid' &&
    css`
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
        overflow-y: auto;
        margin-bottom: 10px;
      `
    }
    return ''
  }}

  ${({ $layout, $isInPopover, $isGrouped }) =>
    $layout === 'grid' && $isGrouped
      ? css`
          max-height: ${$isInPopover ? '50vh' : '300px'};
          overflow-y: auto;
          border: 0.5px solid var(--color-border);
          padding: 10px;
          border-radius: 6px;
        `
      : css`
          overflow-y: auto;
          border: 0.5px solid transparent;
          padding: 0 10px;
          border-radius: 6px;
        `}
`

const GroupMenuBar = styled.div<{ $layout: MultiModelMessageStyle }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  margin-top: 10px;
  justify-content: space-between;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  height: 40px;
  margin-left: ${({ $layout }) => ($layout === 'horizontal' ? '0' : '40px')};
  transition: all 0.3s ease;
`

const LayoutContainer = styled.div`
  display: flex;
  gap: 10px;
  flex-direction: row;
`

const LayoutOption = styled.div<{ active: boolean }>`
  cursor: pointer;
  padding: 2px 10px;
  border-radius: 4px;
  background-color: ${({ active }) => (active ? 'var(--color-background-soft)' : 'transparent')};

  &:hover {
    background-color: ${({ active }) => (active ? 'var(--color-background-soft)' : 'var(--color-hover)')};
  }
`

const ModelsContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  &::-webkit-scrollbar {
    display: none;
  }
`

const Segmented = styled(AntdSegmented)`
  .ant-segmented-item {
    background-color: transparent !important;
    transition: none !important;
    &:hover {
      background: transparent !important;
    }
  }
  .ant-segmented-thumb,
  .ant-segmented-item-selected {
    background-color: transparent !important;
    border: 0.5px solid var(--color-border);
    transition: none !important;
  }
`

const SegmentedLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 0;
`

const ModelName = styled.span`
  font-weight: 500;
  font-size: 12px;
`

export default MessageGroup
