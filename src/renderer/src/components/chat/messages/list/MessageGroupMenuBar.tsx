import {
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  FolderOutlined,
  NumberOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { Button, Tooltip } from '@cherrystudio/ui'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '../blocks'
import { useMessageList } from '../MessageListProvider'
import MessageGroupModelList from './MessageGroupModelList'
import MessageGroupSettings from './MessageGroupSettings'

interface Props {
  multiModelMessageStyle: MultiModelMessageStyle
  setMultiModelMessageStyle: (style: MultiModelMessageStyle) => void
  messages: Message[]
  selectMessageId: string
  setSelectedMessage: (message: Message) => void
}

const MessageGroupMenuBar: FC<Props> = ({
  multiModelMessageStyle,
  setMultiModelMessageStyle,
  messages,
  selectMessageId,
  setSelectedMessage
}) => {
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const { actions } = useMessageList()

  const handleDeleteGroup = async () => {
    const askId = messages[0]?.askId
    if (!askId || !actions.deleteMessageGroup) return

    window.modal.confirm({
      title: t('message.group.delete.title'),
      content: t('message.group.delete.content'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      okText: t('common.delete'),
      onOk: () => actions.deleteMessageGroup?.(askId)
    })
  }

  const isFailedMessage = (m: Message) => {
    if (m.role !== 'assistant') return false
    const isError = (m.status || '').toLowerCase() === 'error'
    const parts = partsMap?.[m.id]
    const content = parts ? getTextFromParts(parts) : getMainTextContent(m)
    const noContent = !content || content.trim().length === 0
    const noBlocks = !m.blocks || m.blocks.length === 0
    return isError || noContent || noBlocks
  }

  const isTransmittingMessage = (m: Message) => {
    if (m.role !== 'assistant') return false
    const status = m.status as AssistantMessageStatus
    return (
      status === AssistantMessageStatus.PROCESSING ||
      status === AssistantMessageStatus.PENDING ||
      status === AssistantMessageStatus.SEARCHING
    )
  }

  const hasFailedMessages =
    !!actions.regenerateMessage && messages.some((m) => isFailedMessage(m) && !isTransmittingMessage(m))

  const handleRetryAll = async () => {
    const candidates = messages.filter((m) => isFailedMessage(m) && !isTransmittingMessage(m))

    for (const msg of candidates) {
      try {
        await actions.regenerateMessage?.(msg.id)
      } catch (e) {
        // swallow per-item errors to continue others
      }
    }
  }

  const multiModelMessageStyleTextByLayout = {
    fold: t('message.message.multi_model_style.fold.label'),
    vertical: t('message.message.multi_model_style.vertical'),
    horizontal: t('message.message.multi_model_style.horizontal'),
    grid: t('message.message.multi_model_style.grid')
  } as const

  return (
    <GroupMenuBar $layout={multiModelMessageStyle} className="group-menu-bar">
      <RowFlex className="flex-1 items-center overflow-hidden">
        <LayoutContainer>
          {(['fold', 'vertical', 'horizontal', 'grid'] as const).map((layout) => (
            <Tooltip
              delay={500}
              key={layout}
              content={
                t('message.message.multi_model_style.label') + ': ' + multiModelMessageStyleTextByLayout[layout]
              }>
              <LayoutOption
                $active={multiModelMessageStyle === layout}
                onClick={() => setMultiModelMessageStyle(layout)}>
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
            </Tooltip>
          ))}
        </LayoutContainer>
        {multiModelMessageStyle === 'fold' && (
          <MessageGroupModelList
            messages={messages}
            selectMessageId={selectMessageId}
            setSelectedMessage={setSelectedMessage}
          />
        )}
        {multiModelMessageStyle === 'grid' && <MessageGroupSettings />}
      </RowFlex>
      {hasFailedMessages && (
        <Tooltip content={t('message.group.retry_failed')} delay={600}>
          <Button variant="ghost" size="sm" onClick={handleRetryAll} className="mr-1">
            <ReloadOutlined />
          </Button>
        </Tooltip>
      )}
      {actions.deleteMessageGroup && (
        <Button variant="ghost" size="sm" onClick={handleDeleteGroup}>
          <DeleteOutlined style={{ color: 'var(--color-error)' }} />
        </Button>
      )}
    </GroupMenuBar>
  )
}

const GroupMenuBar = ({
  className,
  $layout,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $layout: MultiModelMessageStyle }) => {
  void $layout
  return (
    <div
      className={[
        'group-menu-bar mx-2.5 mt-2 mb-4 flex h-10 flex-row items-center justify-between gap-2.5 overflow-hidden rounded-[10px] border-(--color-border) border-[0.5px] p-2',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

const LayoutContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex flex-row gap-1', className].filter(Boolean).join(' ')} {...props} />
)

const LayoutOption = ({
  className,
  $active,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $active: boolean }) => (
  <div
    className={[
      'cursor-pointer rounded px-1.5 py-0.5 hover:bg-(--color-hover)',
      $active && 'bg-(--color-background-soft) hover:bg-(--color-background-soft)',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

export default memo(MessageGroupMenuBar)
