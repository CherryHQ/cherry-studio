import { ArrowsAltOutlined, ShrinkOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setFoldDisplayMode } from '@renderer/store/settings'
import type { Model } from '@renderer/types'
import { AssistantMessageStatus, type Message } from '@renderer/types/newMessage'
import { lightbulbSoftVariants } from '@renderer/utils/motionVariants'
import { Avatar, Segmented as AntdSegmented, Tooltip } from 'antd'
import { motion } from 'motion/react'
import { FC, memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MessageGroupModelListProps {
  messages: Message[]
  selectMessageId: string
  setSelectedMessage: (message: Message) => void
}

type DisplayMode = 'compact' | 'expanded'

const MessageGroupModelList: FC<MessageGroupModelListProps> = ({ messages, selectMessageId, setSelectedMessage }) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const { foldDisplayMode } = useSettings()
  const isCompact = foldDisplayMode === 'compact'

  const isMessageProcessing = useCallback((message: Message) => {
    return [
      AssistantMessageStatus.PENDING,
      AssistantMessageStatus.PROCESSING,
      AssistantMessageStatus.SEARCHING
    ].includes(message.status as AssistantMessageStatus)
  }, [])

  const renderLabel = useCallback(
    (message: Message) => {
      const modelTip = message.model?.name
      const isProcessing = isMessageProcessing(message)

      if (isCompact) {
        return (
          <Tooltip key={message.id} title={modelTip} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <AvatarWrapper
              className="avatar-wrapper"
              $isSelected={message.id === selectMessageId}
              onClick={() => {
                setSelectedMessage(message)
              }}>
              <motion.span variants={lightbulbSoftVariants} animate={isProcessing ? 'active' : 'idle'} initial="idle">
                <ModelAvatar model={message.model as Model} size={22} />
              </motion.span>
            </AvatarWrapper>
          </Tooltip>
        )
      }
      return (
        <SegmentedLabel>
          <ModelAvatar className={isProcessing ? 'animation-pulse' : ''} model={message.model as Model} size={20} />
          <ModelName>{message.model?.name}</ModelName>
        </SegmentedLabel>
      )
    },
    [isCompact, isMessageProcessing, selectMessageId, setSelectedMessage]
  )

  return (
    <Container>
      <Tooltip
        title={
          isCompact
            ? t('message.message.multi_model_style.fold.expand')
            : t('message.message.multi_model_style.fold.compress')
        }
        placement="top"
        mouseEnterDelay={0.5}
        mouseLeaveDelay={0}>
        <DisplayModeToggle
          displayMode={foldDisplayMode}
          onClick={() => dispatch(setFoldDisplayMode(isCompact ? 'expanded' : 'compact'))}>
          {isCompact ? <ArrowsAltOutlined /> : <ShrinkOutlined />}
        </DisplayModeToggle>
      </Tooltip>
      <ModelsContainer $displayMode={foldDisplayMode}>
        {isCompact ? (
          /* Compact style display */
          <Avatar.Group className="avatar-group">{messages.map((message) => renderLabel(message))}</Avatar.Group>
        ) : (
          /* Expanded style display */
          <Segmented
            value={selectMessageId}
            onChange={(value) => {
              const message = messages.find((message) => message.id === value) as Message
              setSelectedMessage(message)
            }}
            options={messages.map((message) => ({
              label: renderLabel(message),
              value: message.id
            }))}
            size="small"
          />
        )}
      </ModelsContainer>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
  overflow: hidden;
  align-items: center;
  margin-left: 4px;
`

const DisplayModeToggle = styled.div<{ displayMode: DisplayMode }>`
  display: flex;
  cursor: pointer;
  padding: 2px 6px 3px 6px;
  border-radius: 4px;
  width: 26px;
  height: 26px;

  &:hover {
    background-color: var(--color-hover);
  }
`

const ModelsContainer = styled(Scrollbar)<{ $displayMode: DisplayMode }>`
  display: flex;
  flex-direction: ${(props) => (props.$displayMode === 'expanded' ? 'column' : 'row')};
  justify-content: ${(props) => (props.$displayMode === 'expanded' ? 'space-between' : 'flex-start')};
  align-items: center;
  overflow-x: auto;
  flex: 1;
  padding: 0 8px;

  &::-webkit-scrollbar {
    display: none;
  }

  /* Card mode styles */
  .avatar-group.ant-avatar-group {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    padding: 6px 4px;

    /* Base style - default overlapping effect */
    & > * {
      margin-left: -6px !important;
      transition:
        transform 0.18s ease-out,
        margin 0.18s ease-out !important;
      position: relative;
      will-change: transform;
    }

    & > *:first-child {
      margin-left: 0 !important;
    }

    /* Element before the hovered one */
    & > *:has(+ *:hover) {
      margin-right: 2px !important;
      /* Use transform instead of margin to reduce layout recalculations */
      transform: translateX(-2px);
    }

    /* Element after the hovered one */
    & > *:hover + * {
      margin-left: 5px !important;
      /* Avoid transform here to prevent jittering */
    }

    /* Second element after the hovered one */
    & > *:hover + * + * {
      margin-left: -4px !important;
    }
  }
`

const AvatarWrapper = styled.div<{ $isSelected: boolean }>`
  cursor: pointer;
  display: inline-flex;
  border-radius: 50%;
  background: var(--color-background);
  transition:
    transform 0.18s ease-out,
    margin 0.18s ease-out,
    filter 0.18s ease-out;
  z-index: ${(props) => (props.$isSelected ? 1 : 0)};
  border: ${(props) => (props.$isSelected ? '2px solid var(--color-primary)' : 'none')};

  &:hover {
    transform: translateX(6px) scale(1.15);
    filter: brightness(1.02);
    margin-left: 8px !important;
    margin-right: 4px !important;
  }
`

const Segmented = styled(AntdSegmented)`
  width: 100%;
  background-color: transparent !important;

  .ant-segmented-item {
    border-radius: var(--list-item-border-radius) !important;
    &:hover {
      background: transparent !important;
    }
  }
  .ant-segmented-thumb,
  .ant-segmented-item-selected {
    border: 0.5px solid var(--color-border);
    border-radius: var(--list-item-border-radius) !important;
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

export default memo(MessageGroupModelList)
