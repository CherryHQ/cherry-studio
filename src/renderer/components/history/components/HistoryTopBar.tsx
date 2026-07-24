import { Button, ConfirmDialog, SearchInput, SelectDropdown } from '@cherrystudio/ui'
import { FolderInput, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ALL_SOURCE_ID } from '../historyRecordsHelpers'
import type { HistoryBulkMoveTarget, HistoryRecordsMode } from '../historyRecordsTypes'

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
