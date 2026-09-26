import { Save, Upload, X } from 'lucide-react'
import type { FC, HTMLAttributes } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Tooltip } from '@cherrystudio/ui'
import { getMessageDeleteUnavailableText } from '@renderer/components/chat/messages/utils/messageDeleteAvailability'
import { type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import CopyIcon from '@renderer/components/icons/CopyIcon'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import type { MessageDeleteAvailability } from '@renderer/hooks/chat/ChatWriteContext'
import { cn } from '@renderer/utils/style'

import type { MessageMenuExportOptions, SelectAllState, SelectedMessagesExportTarget } from './types'

interface Props {
  selectedMessageIds: readonly string[]
  isMultiSelectMode: boolean
  selectAllState?: SelectAllState
  selectAllDisabled?: boolean
  isSelectAllLoading?: boolean
  onToggleSelectAll?: (checked: boolean) => void
  onSave?: () => void
  onCopy?: () => void
  onExport?: (target: SelectedMessagesExportTarget) => void
  exportMenuOptions?: MessageMenuExportOptions
  onDelete?: () => void
  deleteDisabledReason?: Extract<MessageDeleteAvailability, { enabled: false }>['reason']
  onClose: () => void
}

// Same destinations/order/grouping as the single-message Export menu minus
// the per-message-capture and Save-group variants, which stay single-message.
const EXPORT_TARGETS: {
  target: SelectedMessagesExportTarget
  option: keyof MessageMenuExportOptions
  labelKey: string
  group: 'file' | 'external'
}[] = [
  { target: 'markdown', option: 'markdown', labelKey: 'chat.topics.export.md.label', group: 'file' },
  { target: 'markdown-reason', option: 'markdown_reason', labelKey: 'chat.topics.export.md.reason', group: 'file' },
  { target: 'word', option: 'docx', labelKey: 'chat.topics.export.word', group: 'file' },
  { target: 'notion', option: 'notion', labelKey: 'chat.topics.export.notion', group: 'external' },
  { target: 'yuque', option: 'yuque', labelKey: 'chat.topics.export.yuque', group: 'external' },
  { target: 'obsidian', option: 'obsidian', labelKey: 'chat.topics.export.obsidian', group: 'external' },
  { target: 'joplin', option: 'joplin', labelKey: 'chat.topics.export.joplin', group: 'external' },
  { target: 'siyuan', option: 'siyuan', labelKey: 'chat.topics.export.siyuan', group: 'external' }
]

const MultiSelectActionPopup: FC<Props> = ({
  selectedMessageIds,
  isMultiSelectMode,
  selectAllState,
  selectAllDisabled,
  isSelectAllLoading,
  onToggleSelectAll,
  onSave,
  onCopy,
  onExport,
  exportMenuOptions,
  onDelete,
  deleteDisabledReason,
  onClose
}) => {
  const { t } = useTranslation()
  const exportItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    if (!onExport) return []
    const toItem = ({ target, labelKey }: (typeof EXPORT_TARGETS)[number]): CommandContextMenuExtraItem => ({
      type: 'item',
      id: `multi-select-export.${target}`,
      label: t(labelKey),
      onSelect: () => onExport(target)
    })
    const enabledTargets = EXPORT_TARGETS.filter(({ option }) => exportMenuOptions?.[option])
    const fileItems = enabledTargets.filter(({ group }) => group === 'file').map(toItem)
    const externalItems = enabledTargets.filter(({ group }) => group === 'external').map(toItem)
    const separator: CommandContextMenuExtraItem = { type: 'separator' }
    return [...fileItems, ...(fileItems.length > 0 && externalItems.length > 0 ? [separator] : []), ...externalItems]
  }, [exportMenuOptions, onExport, t])

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
          {exportItems.length > 0 && (
            <Tooltip content={t('chat.topics.export.title')}>
              <CommandPopupMenu
                location="webcontents.context"
                extraItems={exportItems}
                align="center"
                side="top"
                deferActionsUntilClosed>
                <Button
                  className="rounded-full"
                  variant="ghost"
                  disabled={isActionDisabled || isSelectAllLoading}
                  aria-label={t('chat.topics.export.title')}
                  size="icon">
                  <Upload size={16} />
                </Button>
              </CommandPopupMenu>
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
