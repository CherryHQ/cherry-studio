import {
  Button,
  ConfirmDialog,
  SearchInput,
  Select,
  SelectContent,
  SelectDropdown,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { FolderInput, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ALL_SOURCE_ID } from '../historyRecordsHelpers'
import type {
  HistoryBulkMoveTarget,
  HistoryRecordsMode,
  HistorySourceStatus,
  HistoryStatusOption
} from '../historyRecordsTypes'

interface HistoryTopBarProps {
  mode: HistoryRecordsMode
  /** Left navbar slot (the shared sidebar toggle). */
  toolbarLeading?: ReactNode
  searchText: string
  searchPlaceholder: string
  onSearchTextChange: (value: string) => void
  selectedSourceId: string
  onSourceSelect: (sourceId: string) => void
  renderSourceFilter: (selectedId: string | null, onSelect: (id: string | null) => void) => ReactNode
  statusOptions?: HistoryStatusOption[]
  statusLabel?: string
  statusPlaceholder?: string
  selectedStatus?: HistorySourceStatus
  onStatusSelect?: (status: HistorySourceStatus) => void
  selectedCount: number
  bulkDeleteCount: number
  bulkMoveTargets?: readonly HistoryBulkMoveTarget[]
  onBulkDelete?: () => void | Promise<void>
  onBulkMove?: (targetId: string) => void | Promise<void>
}

const HistoryTopBar = ({
  mode,
  toolbarLeading,
  searchText,
  searchPlaceholder,
  onSearchTextChange,
  selectedSourceId,
  onSourceSelect,
  renderSourceFilter,
  statusOptions,
  statusLabel,
  statusPlaceholder,
  selectedStatus,
  onStatusSelect,
  selectedCount,
  bulkDeleteCount,
  bulkMoveTargets = [],
  onBulkDelete,
  onBulkMove
}: HistoryTopBarProps) => {
  const { t } = useTranslation()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const moveTargets = useMemo(() => Array.from(bulkMoveTargets), [bulkMoveTargets])
  const selectedMoveTarget = useMemo(
    () => moveTargets.find((target) => target.id === moveTargetId),
    [moveTargetId, moveTargets]
  )
  const canBulkDelete = bulkDeleteCount > 0 && !!onBulkDelete
  const canBulkMove = mode === 'assistant' && selectedCount > 0 && moveTargets.length > 0 && !!onBulkMove
  const deleteTitle =
    mode === 'assistant' ? t('history.records.bulkDeleteTopics.title') : t('history.records.bulkDeleteSessions.title')
  const deleteDescription =
    mode === 'assistant'
      ? t('history.records.bulkDeleteTopics.description', { count: bulkDeleteCount })
      : t('history.records.bulkDeleteSessions.description', { count: bulkDeleteCount })

  useEffect(() => {
    if (!moveDialogOpen) return
    if (moveTargets.length === 0) {
      setMoveTargetId('')
      return
    }
    if (!moveTargets.some((target) => target.id === moveTargetId)) {
      setMoveTargetId(moveTargets[0].id)
    }
  }, [moveDialogOpen, moveTargetId, moveTargets])

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 bg-card px-2">
        {toolbarLeading ? <div className="flex shrink-0 items-center">{toolbarLeading}</div> : null}

        <div className="w-[220px] max-w-[38vw] [&_[data-slot=input-group-control]]:h-8 [&_[data-slot=input-group]]:h-8">
          <SearchInput
            value={searchText}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(event) => onSearchTextChange(event.target.value)}
            onClear={() => onSearchTextChange('')}
            clearLabel={t('history.records.clearSearch')}
          />
        </div>

        {renderSourceFilter(selectedSourceId === ALL_SOURCE_ID ? null : selectedSourceId, (id) =>
          onSourceSelect(id ?? ALL_SOURCE_ID)
        )}
        {statusOptions && selectedStatus && onStatusSelect && (
          <div className="group/status-select relative flex items-center">
            <Select
              value={selectedStatus === ALL_SOURCE_ID ? '' : selectedStatus}
              onValueChange={(value) => onStatusSelect(value as HistorySourceStatus)}>
              <SelectTrigger
                aria-label={statusLabel}
                className={cn(
                  'h-8 w-[132px] text-xs',
                  selectedStatus !== ALL_SOURCE_ID &&
                    '[&_svg]:transition-opacity group-focus-within/status-select:[&_svg]:opacity-0 group-hover/status-select:[&_svg]:opacity-0'
                )}>
                <SelectValue placeholder={statusPlaceholder ?? statusLabel} />
              </SelectTrigger>
              <SelectContent>
                {statusOptions
                  .filter((option) => option.id !== ALL_SOURCE_ID)
                  .map((option) => (
                    <SelectItem key={option.id} value={option.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        {option.dotClassName && (
                          <span className={cn('size-2 rounded-full bg-current', option.dotClassName)} />
                        )}
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {selectedStatus !== ALL_SOURCE_ID ? (
              <Button
                type="button"
                variant="ghost"
                aria-label={t('common.clear')}
                onClick={(event) => {
                  event.stopPropagation()
                  onStatusSelect(ALL_SOURCE_ID)
                }}
                className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 flex size-5 min-h-0 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground/70 opacity-0 shadow-none transition-[background-color,color,opacity] hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/status-select:pointer-events-auto group-focus-within/status-select:opacity-100 group-hover/status-select:pointer-events-auto group-hover/status-select:opacity-100">
                <X size={12} />
              </Button>
            ) : null}
          </div>
        )}

        <div className="min-w-0 flex-1" />

        {mode === 'assistant' && (
          <Button
            type="button"
            variant="outline"
            className="h-8 gap-1.5 rounded-md px-2.5 text-xs shadow-none"
            disabled={!canBulkMove}
            onClick={() => {
              setMoveTargetId((current) => current || moveTargets[0]?.id || '')
              setMoveDialogOpen(true)
            }}>
            <FolderInput className="size-3.5" />
            <span>
              {t('history.records.bulkMove')}
              {selectedCount > 0 ? ` (${selectedCount})` : ''}
            </span>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-8 gap-1.5 rounded-md px-2.5 text-destructive text-xs shadow-none hover:text-destructive"
          disabled={!canBulkDelete}
          onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="size-3.5" />
          <span>
            {t('history.records.bulkDelete')}
            {bulkDeleteCount > 0 ? ` (${bulkDeleteCount})` : ''}
          </span>
        </Button>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={deleteTitle}
        description={deleteDescription}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          await onBulkDelete?.()
          setDeleteDialogOpen(false)
        }}
      />
      <ConfirmDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        title={t('history.records.bulkMoveTopics.title')}
        description={t('history.records.bulkMoveTopics.description', { count: selectedCount })}
        content={
          <div className="space-y-2">
            <div className="font-medium text-foreground-secondary text-xs leading-4">
              {t('history.records.bulkMoveTopics.target')}
            </div>
            <SelectDropdown
              items={moveTargets}
              selectedId={moveTargetId}
              onSelect={setMoveTargetId}
              placeholder={t('history.records.bulkMoveTopics.placeholder')}
              emptyText={t('history.records.bulkMoveTopics.empty')}
              triggerClassName="h-8 rounded-md border-border-subtle bg-card text-xs shadow-none"
              renderSelected={(target) => <HistoryBulkMoveTargetLabel target={target} />}
              renderItem={(target) => <HistoryBulkMoveTargetLabel target={target} />}
            />
          </div>
        }
        confirmText={t('history.records.bulkMoveTopics.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={async () => {
          if (!selectedMoveTarget) return
          await onBulkMove?.(selectedMoveTarget.id)
          setMoveDialogOpen(false)
        }}
      />
    </>
  )
}

const HistoryBulkMoveTargetLabel = ({ target }: { target: HistoryBulkMoveTarget }) => (
  <span className="flex min-w-0 items-center gap-2">
    {target.icon && <span className="flex size-4 shrink-0 items-center justify-center">{target.icon}</span>}
    <span className="truncate">{target.label}</span>
  </span>
)

export default HistoryTopBar
