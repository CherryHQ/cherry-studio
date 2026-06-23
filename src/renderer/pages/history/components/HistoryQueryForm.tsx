import { Button, ConfirmDialog, Input, SelectDropdown } from '@cherrystudio/ui'
import { FolderInput, Search, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { HistoryRecordsMode } from '../historyRecordsTypes'

export interface HistoryBulkMoveTarget {
  id: string
  label: string
  icon?: ReactNode
}

interface HistoryQueryFormProps {
  mode: HistoryRecordsMode
  bulkMoveTargets?: readonly HistoryBulkMoveTarget[]
  bulkDeleteCount?: number
  resultCount: number
  searchText: string
  selectedCount?: number
  onBulkDelete?: () => void | Promise<void>
  onBulkMove?: (targetId: string) => void | Promise<void>
  onSearchTextChange: (value: string) => void
}

const HistoryQueryForm = ({
  mode,
  bulkMoveTargets = [],
  resultCount,
  searchText,
  selectedCount = 0,
  bulkDeleteCount = selectedCount,
  onBulkDelete,
  onBulkMove,
  onSearchTextChange
}: HistoryQueryFormProps) => {
  const { t } = useTranslation()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const moveTargets = useMemo(() => Array.from(bulkMoveTargets), [bulkMoveTargets])
  const selectedMoveTarget = useMemo(
    () => moveTargets.find((target) => target.id === moveTargetId),
    [moveTargetId, moveTargets]
  )
  const searchPlaceholder = mode === 'assistant' ? t('history.records.searchTopic') : t('history.records.searchSession')
  const canBulkDelete = bulkDeleteCount > 0 && !!onBulkDelete
  const canBulkMove = mode === 'assistant' && selectedCount > 0 && moveTargets.length > 0 && !!onBulkMove
  const deleteTitle =
    mode === 'assistant' ? t('history.records.bulkDeleteTopics.title') : t('history.records.bulkDeleteSessions.title')
  const deleteDescription =
    mode === 'assistant'
      ? t('history.records.bulkDeleteTopics.description', { count: bulkDeleteCount })
      : t('history.records.bulkDeleteSessions.description', {
          count: bulkDeleteCount
        })
  const deleteButtonLabel = t('history.records.bulkDelete')
  const moveButtonLabel = t('history.records.bulkMove')

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
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 bg-card px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="font-medium text-foreground text-sm leading-5">
            {t('history.records.resultCount', { count: resultCount })}
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {mode === 'assistant' && (
            <Button
              type="button"
              className="h-8 gap-1.5 rounded-md border-border-subtle px-2.5 text-xs shadow-none"
              disabled={!canBulkMove}
              variant="outline"
              onClick={() => {
                setMoveTargetId((current) => current || moveTargets[0]?.id || '')
                setMoveDialogOpen(true)
              }}>
              <FolderInput className="size-3.5" />
              <span>
                {moveButtonLabel}
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </span>
            </Button>
          )}
          <Button
            type="button"
            className="h-8 gap-1.5 rounded-md border-border-subtle px-2.5 text-xs shadow-none"
            disabled={!canBulkDelete}
            variant="outline"
            onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="size-3.5" />
            <span>
              {deleteButtonLabel}
              {selectedCount > 0 ? ` (${bulkDeleteCount})` : ''}
            </span>
          </Button>
          <div className="relative w-[236px] max-w-[26vw]">
            <Search
              size={14}
              className="-translate-y-1/2 pointer-events-none absolute start-2.5 top-1/2 text-foreground-muted"
            />
            <Input
              value={searchText}
              className="h-8 rounded-md border-border-subtle bg-card ps-8 text-xs shadow-none"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => onSearchTextChange(event.target.value)}
            />
          </div>
        </div>
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
        description={t('history.records.bulkMoveTopics.description', {
          count: selectedCount
        })}
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

export default HistoryQueryForm
