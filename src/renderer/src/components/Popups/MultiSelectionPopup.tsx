import { Button, Tooltip } from '@cherrystudio/ui'
import { CopyIcon, DeleteIcon } from '@renderer/components/Icons'
import { useChatContext } from '@renderer/hooks/useChatContext'
import type { Topic } from '@renderer/types'
import { cn } from '@renderer/utils'
import { Save, X } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  topic: Topic
}

const MultiSelectActionPopup: FC<Props> = ({ topic }) => {
  const { t } = useTranslation()
  const { toggleMultiSelectMode, selectedMessageIds, isMultiSelectMode, handleMultiSelectAction } =
    useChatContext(topic)

  const handleAction = (action: string) => {
    void handleMultiSelectAction(action, selectedMessageIds)
  }

  const handleClose = () => {
    toggleMultiSelectMode(false)
  }

  if (!isMultiSelectMode) return null

  // TODO: 视情况调整
  // const isActionDisabled = selectedMessages.some((msg) => msg.role === 'user')
  const isActionDisabled = false

  return (
    <Container>
      <ActionBar>
        <SelectionCount>{t('common.selectedMessages', { count: selectedMessageIds.length })}</SelectionCount>
        <ActionButtons>
          <Tooltip content={t('common.save')}>
            <Button
              className="rounded-full"
              variant="ghost"
              disabled={isActionDisabled}
              onClick={() => handleAction('save')}
              size="icon">
              <Save size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('common.copy')}>
            <Button
              className="rounded-full"
              variant="ghost"
              disabled={isActionDisabled}
              onClick={() => handleAction('copy')}
              size="icon">
              <CopyIcon size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('common.delete')}>
            <Button className="rounded-full" variant="ghost" onClick={() => handleAction('delete')} size="icon">
              <DeleteIcon size={16} className="lucide-custom" />
            </Button>
          </Tooltip>
        </ActionButtons>
        <Tooltip content={t('chat.navigation.close')}>
          <Button className="rounded-full" variant="ghost" onClick={handleClose} size="icon">
            <X size={16} />
          </Button>
        </Tooltip>
      </ActionBar>
    </Container>
  )
}

const Container: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('fixed inset-x-0 bottom-0 z-[1000] flex items-center justify-center p-4', className)} {...props} />
)

const ActionBar: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn(
      'flex items-center justify-between gap-4 rounded-[99px] border-[0.5px] border-[var(--color-border)]',
      'bg-[var(--color-background)] p-1 shadow-[0_2px_8px_0_rgb(128_128_128_/_20%)]',
      className
    )}
    {...props}
  />
)

const ActionButtons: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('flex items-center gap-2', className)} {...props} />
)

const SelectionCount: FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('shrink-0 pl-2 text-[14px] text-[var(--color-text-2)]', className)} {...props} />
)

export default MultiSelectActionPopup
