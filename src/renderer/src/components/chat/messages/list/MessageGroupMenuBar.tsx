import { Button, RowFlex, Tooltip } from '@cherrystudio/ui'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import { Columns2, Folder, Grid2X2, RotateCcw, Rows3, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePartsMap } from '../blocks'
import { useMessageListActions } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import MessageGroupModelList from './MessageGroupModelList'
import MessageGroupSettings from './MessageGroupSettings'

interface Props {
  multiModelMessageStyle: MultiModelMessageStyle
  setMultiModelMessageStyle: (style: MultiModelMessageStyle) => void
  messages: MessageListItem[]
  selectMessageId: string
  setSelectedMessage: (message: MessageListItem) => void
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
  const actions = useMessageListActions()

  const handleDeleteGroup = async () => {
    const parentId = messages[0]?.parentId
    if (!parentId || !actions.deleteMessageGroupWithConfirm) return

    await actions.deleteMessageGroupWithConfirm(parentId)
  }

  const isFailedMessage = (m: MessageListItem) => {
    if (m.role !== 'assistant') return false
    const isError = (m.status || '').toLowerCase() === 'error'
    const parts = partsMap?.[m.id]
    const content = parts ? getTextFromParts(parts) : ''
    const noContent = !content || content.trim().length === 0
    return isError || noContent
  }

  const isTransmittingMessage = (m: MessageListItem) => {
    if (m.role !== 'assistant') return false
    return m.status === 'pending'
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
      <RowFlex className="min-w-0 flex-1 items-center gap-1 overflow-hidden">
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
                  <Folder size={14} />
                ) : layout === 'horizontal' ? (
                  <Columns2 size={14} />
                ) : layout === 'vertical' ? (
                  <Rows3 size={14} />
                ) : (
                  <Grid2X2 size={14} />
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
        {multiModelMessageStyle === 'grid' && actions.updateRenderConfig && <MessageGroupSettings />}
      </RowFlex>
      <ActionContainer>
        {hasFailedMessages && (
          <Tooltip content={t('message.group.retry_failed')} delay={600}>
            <Button variant="ghost" size="sm" onClick={handleRetryAll} className="size-7 min-w-7 p-0">
              <RotateCcw size={14} />
            </Button>
          </Tooltip>
        )}
        {actions.deleteMessageGroupWithConfirm && (
          <Button variant="ghost" size="sm" onClick={handleDeleteGroup} className="size-7 min-w-7 p-0">
            <Trash2 size={14} color="var(--color-error-base)" />
          </Button>
        )}
      </ActionContainer>
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
        'group-menu-bar mx-2.5 mt-2 mb-4 flex h-9 flex-row items-center justify-between gap-1 overflow-hidden rounded-[10px] border-[0.5px] border-border px-1.5 py-1',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}

const LayoutContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex shrink-0 flex-row items-center gap-0.5', className].filter(Boolean).join(' ')} {...props} />
)

const LayoutOption = ({
  className,
  $active,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { $active: boolean }) => (
  <div
    className={[
      'flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
      $active && 'bg-muted text-foreground hover:bg-muted',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

const ActionContainer = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={['flex shrink-0 items-center gap-1', className].filter(Boolean).join(' ')} {...props} />
)

export default memo(MessageGroupMenuBar)
