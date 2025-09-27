import { Button, cn, Input } from '@heroui/react'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import { SessionLabel } from '@renderer/pages/settings/AgentSettings/shared'
import { AgentSessionEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { FC, memo } from 'react'
import { useTranslation } from 'react-i18next'

// const logger = loggerService.withContext('AgentItem')

interface SessionItemProps {
  session: AgentSessionEntity
  // use external agentId as SSOT, instead of session.agent_id
  agentId: string
  isDisabled?: boolean
  isLoading?: boolean
  onDelete: () => void
  onPress: () => void
}

const SessionItem: FC<SessionItemProps> = ({ session, agentId, isDisabled, isLoading, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const updateSession = useUpdateSession(agentId)
  const activeSessionId = chat.activeSessionId[agentId]

  const { isEditing, isSaving, editValue, inputRef, startEdit, handleKeyDown, handleValueChange } = useInPlaceEdit({
    onSave: async (value) => {
      if (value !== session.name) {
        await updateSession({ id: session.id, name: value })
      }
    }
  })

  const isActive = activeSessionId === session.id

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger>
          <ButtonContainer
            isDisabled={isDisabled}
            isLoading={isLoading}
            onPress={onPress}
            isActive={isActive}
            onDoubleClick={() => startEdit(session.name ?? '')}>
            <SessionLabelContainer className="name h-full w-full" title={session.name ?? session.id}>
              {isEditing && (
                <Input
                  ref={inputRef}
                  variant="bordered"
                  value={editValue}
                  onValueChange={handleValueChange}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  classNames={{
                    base: 'h-full',
                    mainWrapper: 'h-full',
                    inputWrapper: 'h-full min-h-0 px-1.5',
                    input: isSaving ? 'brightness-50' : undefined
                  }}
                />
              )}
              {!isEditing && <SessionLabel session={session} />}
            </SessionLabelContainer>
          </ButtonContainer>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            key="edit"
            onClick={() => {
              SessionSettingsPopup.show({
                agentId,
                sessionId: session.id
              })
            }}>
            <EditIcon size={14} />
            {t('common.edit')}
          </ContextMenuItem>
          <ContextMenuItem
            key="delete"
            className="text-danger"
            onClick={() => {
              onDelete()
            }}>
            <DeleteIcon size={14} className="lucide-custom text-danger" />
            <span className="text-danger">{t('common.delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}

const ButtonContainer: React.FC<React.ComponentProps<typeof Button> & { isActive?: boolean }> = ({
  isActive,
  className,
  children,
  ...props
}) => {
  const { topicPosition } = useSettings()
  const activeBg = topicPosition === 'left' ? 'bg-[var(--color-list-item)]' : 'bg-foreground-100'
  return (
    <Button
      {...props}
      variant="light"
      className={cn(
        'relative mb-2 flex h-9 flex-row justify-between p-0',
        'rounded-[var(--list-item-border-radius)]',
        'border-[0.5px] border-transparent',
        'w-[calc(var(--assistants-width)_-_20px)]',
        'cursor-pointer',
        isActive ? cn(activeBg, 'shadow-sm') : undefined,
        className
      )}>
      {children}
    </Button>
  )
}

const SessionLabelContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={cn('text-[13px] text-[var(--color-text)]', 'flex flex-row items-center gap-2', className)}
  />
)

export default memo(SessionItem)
