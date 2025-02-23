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
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { MultiModelMessageStyle } from '@renderer/store/settings'
import { Message, Model } from '@renderer/types'
import { Button, Segmented as AntdSegmented } from 'antd'
import { FC, memo } from 'react'
import styled from 'styled-components'

import MessageGroupSettings from './MessageGroupSettings'

interface Props {
  multiModelMessageStyle: MultiModelMessageStyle
  setMultiModelMessageStyle: (style: MultiModelMessageStyle) => void
  messages: Message[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  onDelete: () => void
}

const MessageGroupMenuBar: FC<Props> = ({
  multiModelMessageStyle,
  setMultiModelMessageStyle,
  messages,
  selectedIndex,
  setSelectedIndex,
  onDelete
}) => {
  return (
    <GroupMenuBar $layout={multiModelMessageStyle} className="group-menu-bar">
      <HStack style={{ alignItems: 'center', flex: 1, overflow: 'hidden' }}>
        <LayoutContainer>
          {['fold', 'vertical', 'horizontal', 'grid'].map((layout) => (
            <LayoutOption
              key={layout}
              $active={multiModelMessageStyle === layout}
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
        {multiModelMessageStyle === 'grid' && <MessageGroupSettings />}
      </HStack>
      <Button
        type="text"
        size="small"
        icon={<DeleteOutlined style={{ color: 'var(--color-error)' }} />}
        onClick={onDelete}
      />
    </GroupMenuBar>
  )
}

const GroupMenuBar = styled.div<{ $layout: MultiModelMessageStyle }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin: 0 20px;
  padding: 6px 10px;
  border-radius: 6px;
  margin-top: 10px;
  justify-content: space-between;
  overflow: hidden;
  border: 0.5px solid var(--color-border);
  height: 40px;
  background-color: var(--color-background);
`

const LayoutContainer = styled.div`
  display: flex;
  gap: 10px;
  flex-direction: row;
`

const LayoutOption = styled.div<{ $active: boolean }>`
  cursor: pointer;
  padding: 2px 10px;
  border-radius: 4px;
  background-color: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'transparent')};

  &:hover {
    background-color: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'var(--color-hover)')};
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

export default memo(MessageGroupMenuBar)
