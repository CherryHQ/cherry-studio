import { Button, ConfirmDialog, Input, SelectDropdown } from '@cherrystudio/ui'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
import { MoveRight, Search, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface HistoryBulkMoveTarget {
  id: string
  label: string
  icon?: ReactNode
}

interface HistoryQueryFormProps {
  mode: HistoryRecordsMode
  bulkMoveTargets?: readonly HistoryBulkMoveTarget[]
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
  const searchPlaceholder =
    mode === 'assistant'
      ? t('history.records.searchTopic', '搜索话题...')
      : t('history.records.searchSession', '搜索会话...')
  const canBulkMove = mode === 'assistant' && selectedCount > 0 && moveTargets.length > 0 && !!onBulkMove
  const deleteTitle =
    mode === 'assistant'
      ? t('history.records.bulkDeleteTopics.title', '删除选中的话题')
      : t('history.records.bulkDeleteSessions.title', '删除选中的会话')
  const deleteDescription =
    mode === 'assistant'
      ? t('history.records.bulkDeleteTopics.description', '将删除选中的 {{count}} 个话题。', { count: selectedCount })
      : t('history.records.bulkDeleteSessions.description', '将删除选中的 {{count}} 个会话。', {
          count: selectedCount
        })
  const deleteButtonLabel = t('history.records.bulkDelete', '批量删除')
  const moveButtonLabel = t('history.records.bulkMove', '批量移动')

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
            {t('history.records.resultCount', '{{count}} 条结果', { count: resultCount })}
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {mode === 'assistant' && (
            <Button
              type="button"
              className="h-8 gap-1.5 rounded-md border-border-subtle px-2.5 text-xs shadow-none"
              disabled={!canBulkMove}
              variant="outline"
              aria-label={moveButtonLabel}
              onClick={() => {
                setMoveTargetId((current) => current || moveTargets[0]?.id || '')
                setMoveDialogOpen(true)
              }}>
              <MoveRight className="size-3.5" />
              <span>
                {moveButtonLabel}
                {selectedCount > 0 ? ` (${selectedCount})` : ''}
              </span>
            </Button>
          )}
          <Button
            type="button"
            className="h-8 gap-1.5 rounded-md border-border-subtle px-2.5 text-xs shadow-none"
            disabled={selectedCount === 0 || !onBulkDelete}
            variant="outline"
            aria-label={deleteButtonLabel}
            onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="size-3.5" />
            <span>
              {deleteButtonLabel}
              {selectedCount > 0 ? ` (${selectedCount})` : ''}
            </span>
          </Button>
          <div className="relative w-[236px] max-w-[26vw]">
            <Search
              size={14}
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-foreground-muted"
            />
            <Input
              value={searchText}
              className="h-8 rounded-md border-border-subtle bg-card pl-8 text-xs shadow-none"
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
        confirmText={t('common.delete', '删除')}
        cancelText={t('common.cancel', '取消')}
        destructive
        onConfirm={async () => {
          await onBulkDelete?.()
          setDeleteDialogOpen(false)
        }}
      />
      <ConfirmDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        title={t('history.records.bulkMoveTopics.title', '移动选中的话题')}
        description={t('history.records.bulkMoveTopics.description', '将选中的 {{count}} 个话题移动到目标助手下。', {
          count: selectedCount
        })}
        content={
          <div className="space-y-2">
            <div className="font-medium text-foreground-secondary text-xs leading-4">
              {t('history.records.bulkMoveTopics.target', '目标助手')}
            </div>
            <SelectDropdown
              items={moveTargets}
              selectedId={moveTargetId}
              onSelect={setMoveTargetId}
              placeholder={t('history.records.bulkMoveTopics.placeholder', '选择助手')}
              emptyText={t('history.records.bulkMoveTopics.empty', '暂无可移动到的助手')}
              triggerClassName="h-8 rounded-md border-border-subtle bg-card text-xs shadow-none"
              renderSelected={(target) => <HistoryBulkMoveTargetLabel target={target} />}
              renderItem={(target) => <HistoryBulkMoveTargetLabel target={target} />}
            />
          </div>
        }
        confirmText={t('history.records.bulkMoveTopics.confirm', '移动')}
        cancelText={t('common.cancel', '取消')}
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
