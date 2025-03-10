import { ArrowsAltOutlined, ShrinkOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import Scrollbar from '@renderer/components/Scrollbar'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Message, Model } from '@renderer/types'
import { Avatar, Segmented as AntdSegmented, Tooltip } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MessageGroupModelListProps {
  messages: Message[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
}

type DisplayMode = 'compact' | 'expanded'

const MessageGroupModelList: FC<MessageGroupModelListProps> = ({ messages, selectedIndex, setSelectedIndex }) => {
  const { t } = useTranslation()
  const [displayMode, setDisplayMode] = useState<DisplayMode>('expanded')
  const isCompact = displayMode === 'compact'

  return (
    <ModelsWrapper>
      <DisplayModeToggle displayMode={displayMode} onClick={() => setDisplayMode(isCompact ? 'expanded' : 'compact')}>
        <Tooltip
          title={
            displayMode === 'compact'
              ? t(`message.message.multi_model_style.fold.expand`)
              : t('message.message.multi_model_style.fold.compress')
          }
          placement="top">
          {displayMode === 'compact' ? <ArrowsAltOutlined /> : <ShrinkOutlined />}
        </Tooltip>
      </DisplayModeToggle>

      <ModelsContainer $displayMode={displayMode}>
        {displayMode === 'compact' ? (
          /* Compact style display */
          <Avatar.Group className="avatar-group">
            {messages.map((message, index) => (
              <Tooltip key={index} title={message.model?.name} placement="top" mouseEnterDelay={0.2}>
                <AvatarWrapper
                  className="avatar-wrapper"
                  isSelected={selectedIndex === index}
                  onClick={() => {
                    setSelectedIndex(index)
                    EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messages[index].id, false)
                  }}>
                  <ModelAvatar model={message.model as Model} size={28} />
                </AvatarWrapper>
              </Tooltip>
            ))}
          </Avatar.Group>
        ) : (
          /* Expanded style display */
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
        )}
      </ModelsContainer>
    </ModelsWrapper>
  )
}

const ModelsWrapper = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  overflow: hidden;
`

const DisplayModeToggle = styled.div<{ displayMode: DisplayMode }>`
  position: absolute;
  left: 4px; /* Add more space on the left */
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 28px; /* Increase width */
  height: 28px; /* Add height */
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  border-radius: 4px;
  padding: 2px;

  /* Add hover effect */
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
  margin-left: 24px; /* Space for toggle button */

  /* Hide scrollbar to match original code */
  &::-webkit-scrollbar {
    display: none;
  }

  /* Card mode styles */
  .avatar-group.ant-avatar-group {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    position: relative;
    padding: 6px 4px;

    /* Base style - default overlapping effect */
    & > * {
      margin-left: -6px !important;
      /* Separate transition properties to avoid conflicts */
      transition:
        transform 0.18s ease-out,
        margin 0.18s ease-out !important;
      position: relative;
      /* Only use will-change for transform to reduce rendering overhead */
      will-change: transform;
    }

    /* First element has no left margin */
    & > *:first-child {
      margin-left: 0 !important;
    }

    /* Using :has() selector to handle the element before the hovered one */
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

const AvatarWrapper = styled.div<{ isSelected: boolean }>`
  cursor: pointer;
  display: inline-flex;
  border-radius: 50%;
  /* Keep z-index separate from transitions to avoid rendering issues */
  z-index: ${(props) => (props.isSelected ? 2 : 0)};
  background: var(--color-background);
  /* Simplify transitions to reduce jittering */
  transition:
    transform 0.18s ease-out,
    margin 0.18s ease-out,
    box-shadow 0.18s ease-out,
    filter 0.18s ease-out;
  box-shadow: 0 0 0 1px var(--color-background);

  /* Use CSS variables to define animation parameters for easy adjustment */
  --hover-scale: 1.15;
  --hover-x-offset: 6px;
  --hover-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);

  &:hover {
    /* z-index is applied immediately, not part of the transition */
    z-index: 10;
    transform: translateX(var(--hover-x-offset)) scale(var(--hover-scale));
    box-shadow: var(--hover-shadow);
    filter: brightness(1.02);
    margin-left: 8px !important;
    margin-right: 4px !important;
  }

  ${(props) =>
    props.isSelected &&
    `
    border: 2px solid var(--color-primary);
    z-index: 2;

    &:hover {
      /* z-index is applied immediately, not part of the transition */
      z-index: 10;
      border: 2px solid var(--color-primary);
      filter: brightness(1.02);
      transform: translateX(var(--hover-x-offset)) scale(var(--hover-scale));
      margin-left: 8px !important;
      margin-right: 4px !important;
    }
  `}
`

const Segmented = styled(AntdSegmented)`
  width: 100%;
  background-color: transparent !important;

  .ant-segmented-item {
    background-color: transparent !important;
    transition: none !important;
    border-radius: var(--list-item-border-radius) !important;
    box-shadow: none !important;
    &:hover {
      background: transparent !important;
    }
  }
  .ant-segmented-thumb,
  .ant-segmented-item-selected {
    background-color: transparent !important;
    border: 0.5px solid var(--color-border);
    transition: none !important;
    border-radius: var(--list-item-border-radius) !important;
    box-shadow: none !important;
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

export default MessageGroupModelList
