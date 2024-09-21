import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  ForkOutlined,
  MenuOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { Message, Model } from '@renderer/types'
import { removeTrailingDoubleSpaces } from '@renderer/utils'
import { Dropdown, Popconfirm, Tooltip } from 'antd'
import { FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SelectModelDropdown from '../components/SelectModelDropdown'

interface Props {
  message: Message
  model?: Model
  index?: number
  isLastMessage: boolean
  isAssistantMessage: boolean
  setModel: (model: Model) => void
  onDeleteMessage?: (message: Message) => void
}

const MessageMenubar: FC<Props> = (props) => {
  const { message, index, model, isLastMessage, isAssistantMessage, setModel, onDeleteMessage } = props
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const isUserMessage = message.role === 'user'
  const canRegenerate = isLastMessage && isAssistantMessage

  const onEdit = useCallback(() => EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, message), [message])

  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(removeTrailingDoubleSpaces(message.content))
    window.message.success({ content: t('message.copied'), key: 'copy-message' })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [message.content, t])

  const onRegenerate = useCallback(
    (model: Model) => {
      setModel(model)
      setTimeout(() => EventEmitter.emit(EVENT_NAMES.REGENERATE_MESSAGE, model), 100)
    },
    [setModel]
  )

  const onNewBranch = useCallback(() => {
    EventEmitter.emit(EVENT_NAMES.NEW_BRANCH, index)
  }, [index])

  const dropdownItems = useMemo(
    () => [
      {
        label: t('chat.save'),
        key: 'save',
        icon: <SaveOutlined />,
        onClick: () => {
          const fileName = message.createdAt + '.md'
          window.api.saveFile(fileName, message.content)
        }
      }
    ],
    [t, message]
  )

  return (
    <MenusBar className={`menubar ${isLastMessage && 'show'}`}>
      {message.role === 'user' && (
        <Tooltip title="Edit" mouseEnterDelay={0.8}>
          <ActionButton onClick={onEdit}>
            <EditOutlined />
          </ActionButton>
        </Tooltip>
      )}
      <Tooltip title={t('common.copy')} mouseEnterDelay={0.8}>
        <ActionButton onClick={onCopy}>
          {!copied && <i className="iconfont icon-copy"></i>}
          {copied && <CheckOutlined style={{ color: 'var(--color-primary)' }} />}
        </ActionButton>
      </Tooltip>
      {canRegenerate && (
        <SelectModelDropdown model={model} onSelect={onRegenerate} placement="topLeft">
          <Tooltip title={t('common.regenerate')} mouseEnterDelay={0.8}>
            <ActionButton>
              <SyncOutlined />
            </ActionButton>
          </Tooltip>
        </SelectModelDropdown>
      )}
      {isAssistantMessage && (
        <Tooltip title={t('chat.message.new.branch')} mouseEnterDelay={0.8}>
          <ActionButton onClick={onNewBranch}>
            <ForkOutlined />
          </ActionButton>
        </Tooltip>
      )}
      <Popconfirm
        title={t('message.message.delete.content')}
        okButtonProps={{ danger: true }}
        icon={<QuestionCircleOutlined style={{ color: 'red' }} />}
        onConfirm={() => onDeleteMessage?.(message)}>
        <Tooltip title={t('common.delete')} mouseEnterDelay={1}>
          <ActionButton>
            <DeleteOutlined />
          </ActionButton>
        </Tooltip>
      </Popconfirm>
      {!isUserMessage && (
        <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="topRight" arrow>
          <ActionButton>
            <MenuOutlined />
          </ActionButton>
        </Dropdown>
      )}
    </MenusBar>
  )
}

const MenusBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  margin-left: -5px;
`

const ActionButton = styled.div`
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 30px;
  height: 30px;
  transition: all 0.2s ease;
  &:hover {
    background-color: var(--color-background-mute);
    .anticon {
      color: var(--color-text-1);
    }
  }
  .anticon,
  .iconfont {
    cursor: pointer;
    font-size: 14px;
    color: var(--color-icon);
  }
  &:hover {
    color: var(--color-text-1);
  }
`

export default MessageMenubar
