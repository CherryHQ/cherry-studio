import { Button, Tooltip } from '@cherrystudio/ui'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import type { MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import { cn } from '@renderer/utils/style'
import { Save, X } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  selectedMessageIds: readonly string[]
  isMultiSelectMode: boolean
  onSave?: () => void
  onCopy?: () => void
  onDelete?: () => void
  deleteDisabledReason?: Extract<MessageDeleteAvailability, { enabled: false }>['reason']
  onClose: () => void
}

const MultiSelectActionPopup: FC<Props> = ({
  selectedMessageIds,
  isMultiSelectMode,
  onSave,
  onCopy,
  onDelete,
  deleteDisabledReason,
  onClose
}) => {
  const { t } = useTranslation()

  if (!isMultiSelectMode) return null

  const isActionDisabled = selectedMessageIds.length === 0
  const deleteTooltip =
    deleteDisabledReason === 'root-unavailable'
      ? t('message.delete.root_unavailable')
      : deleteDisabledReason === 'first-turn'
        ? t('message.delete.first_turn_not_supported')
        : t('common.delete')

  return (
    <Container>
      <ActionBar>
        <SelectionCount>{t('common.selectedMessages', { count: selectedMessageIds.length })}</SelectionCount>
        <ActionButtons>
          {onSave && (
            <Tooltip content={t('common.save')}>
              <Button className="rounded-full" variant="ghost" disabled={isActionDisabled} onClick={onSave} size="icon">
                <Save size={16} />
              </Button>
            </Tooltip>
          )}
          {onCopy && (
            <Tooltip content={t('common.copy')}>
              <Button className="rounded-full" variant="ghost" disabled={isActionDisabled} onClick={onCopy} size="icon">
                <CopyIcon size={16} />
              </Button>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip content={deleteTooltip}>
              <Button
                className="rounded-full"
                variant="ghost"
                disabled={isActionDisabled || !!deleteDisabledReason}
                onClick={onDelete}
                size="icon">
                <DeleteIcon size={16} className="lucide-custom" />
              </Button>
            </Tooltip>
          )}
        </ActionButtons>
        <Tooltip content={t('chat.navigation.close')}>
          <Button className="rounded-full" variant="ghost" onClick={onClose} size="icon">
            <X size={16} />
          </Button>
        </Tooltip>
      </ActionBar>
    </Container>
  )
}

const Container: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('fixed inset-x-0 bottom-0 z-300 flex items-center justify-center p-4', className)} {...props} />
)

const ActionBar: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex items-center justify-between gap-4 rounded-[99px] border-[0.5px] border-border',
      'bg-background p-1 shadow-md',
      className
    )}
    {...props}
  />
)

const ActionButtons: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex items-center gap-2', className)} {...props} />
)

const SelectionCount: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('shrink-0 pl-2 text-[14px] text-foreground-secondary', className)} {...props} />
)

export default MultiSelectActionPopup
