import { Button, Tooltip } from '@cherrystudio/ui'
import { CopyIcon, DeleteIcon } from '@renderer/components/Icons'
import { useChatContext } from '@renderer/hooks/useChatContext'
import type { Topic } from '@renderer/types'
import { cn } from '@renderer/utils'
import { Save, X } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Legacy props — the v1 chat content reads selection state from
 * `useChatContext` and only passes the active `topic`.
 */
interface LegacyProps {
  topic: Topic
}

/**
 * Controlled props — the v2 message renderer drives selection state and
 * action handlers explicitly, without `ChatContext`.
 */
interface ControlledProps {
  selectedMessageIds: readonly string[]
  isMultiSelectMode: boolean
  onSave?: () => void
  onCopy?: () => void
  onDelete?: () => void
  onClose: () => void
}

type Props = LegacyProps | ControlledProps

const isControlledProps = (props: Props): props is ControlledProps => 'selectedMessageIds' in props

interface PopupViewProps {
  selectedMessageIds: readonly string[]
  isMultiSelectMode: boolean
  isActionDisabled: boolean
  onSave?: () => void
  onCopy?: () => void
  onDelete?: () => void
  onClose: () => void
}

const MultiSelectActionPopupView: FC<PopupViewProps> = ({
  selectedMessageIds,
  isMultiSelectMode,
  isActionDisabled,
  onSave,
  onCopy,
  onDelete,
  onClose
}) => {
  const { t } = useTranslation()

  if (!isMultiSelectMode) return null

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
            <Tooltip content={t('common.delete')}>
              <Button
                className="rounded-full"
                variant="ghost"
                disabled={isActionDisabled}
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

const LegacyMultiSelectActionPopup: FC = () => {
  const { toggleMultiSelectMode, selectedMessageIds, isMultiSelectMode, handleMultiSelectAction } = useChatContext()

  return (
    <MultiSelectActionPopupView
      selectedMessageIds={selectedMessageIds}
      isMultiSelectMode={isMultiSelectMode}
      isActionDisabled={false}
      onSave={() => void handleMultiSelectAction('save', selectedMessageIds)}
      onCopy={() => void handleMultiSelectAction('copy', selectedMessageIds)}
      onDelete={() => void handleMultiSelectAction('delete', selectedMessageIds)}
      onClose={() => toggleMultiSelectMode(false)}
    />
  )
}

const MultiSelectActionPopup: FC<Props> = (props) => {
  if (isControlledProps(props)) {
    return (
      <MultiSelectActionPopupView
        selectedMessageIds={props.selectedMessageIds}
        isMultiSelectMode={props.isMultiSelectMode}
        isActionDisabled={props.selectedMessageIds.length === 0}
        onSave={props.onSave}
        onCopy={props.onCopy}
        onDelete={props.onDelete}
        onClose={props.onClose}
      />
    )
  }

  return <LegacyMultiSelectActionPopup />
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
  <div className={cn('shrink-0 pl-2 text-[14px] text-foreground-secondary', className)} {...props} />
)

export default MultiSelectActionPopup
