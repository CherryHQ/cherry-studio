import { Save, X } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Tooltip } from '@cherrystudio/ui'
import { getMessageDeleteUnavailableText } from '@renderer/components/chat/messages/utils/messageDeleteAvailability'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import type { MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import { cn } from '@renderer/utils/style'

import type { SelectAllState } from './types'

interface Props {
  selectedMessageIds: readonly string[]
  isMultiSelectMode: boolean
  selectAllState?: SelectAllState
  selectAllDisabled?: boolean
  isSelectAllLoading?: boolean
  onToggleSelectAll?: (checked: boolean) => void
  onSave?: () => void
  onCopy?: () => void
  onDelete?: () => void
  deleteDisabledReason?: Extract<MessageDeleteAvailability, { enabled: false }>['reason']
  onClose: () => void
}

const MultiSelectActionPopup: FC<Props> = ({
  selectedMessageIds,
  isMultiSelectMode,
  selectAllState,
  selectAllDisabled,
  isSelectAllLoading,
  onToggleSelectAll,
  onSave,
  onCopy,
  onDelete,
  deleteDisabledReason,
  onClose
}) => {
  const { t } = useTranslation()

  if (!isMultiSelectMode) return null

  const isActionDisabled = selectedMessageIds.length === 0
  const deleteTooltip = getMessageDeleteUnavailableText(deleteDisabledReason, t) ?? t('common.delete')

  return (
    <Container>
      <ActionBar>
        <div className="flex shrink-0 items-center gap-2 pl-2">
          {onToggleSelectAll && (
            <Checkbox
              size="sm"
              checked={selectAllState}
              disabled={selectAllDisabled || isSelectAllLoading}
              aria-label={t('common.select_all')}
              onCheckedChange={(checked) => onToggleSelectAll(Boolean(checked))}
            />
          )}
          <SelectionCount>{t('common.selectedMessages', { count: selectedMessageIds.length })}</SelectionCount>
        </div>
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
  <div className={cn('shrink-0 text-[14px] text-muted-foreground', className)} {...props} />
)

export default MultiSelectActionPopup
