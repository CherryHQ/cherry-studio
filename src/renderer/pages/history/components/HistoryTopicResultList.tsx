import { EmptyState, RowFlex } from '@cherrystudio/ui'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EditNameDialog from '@renderer/components/EditNameDialog'
import type {
  TopicMenuActionContextOverride,
  TopicMenuPreset
} from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { cn } from '@renderer/utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { Bot, MessageSquareText } from 'lucide-react'
import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatHistoryTime,
  HistoryActionContextMenu,
  HistoryActionsCell,
  historyBodyCellClassName,
  historyBodyRowClassName,
  historyFixedActionCellClassName,
  historyFixedActionShadowClassName,
  HistorySelectionCell,
  historyTableGridClassName,
  HistoryTableHeader,
  HistoryTitleButton,
  HistoryVirtualTable
} from './HistoryTableParts'

interface HistoryTopicResultListProps {
  topics: readonly Topic[]
  assistantById: ReadonlyMap<string, Assistant>
  unlinkedAssistantLabel: string
  isLoading?: boolean
  isTopicPinned?: (topicId: string) => boolean
  selectedTopicIds?: readonly string[]
  onToggleTopicPin?: (topic: Topic) => void | Promise<void>
  topicMenuPreset?: TopicMenuPreset<Topic>
  onTopicRename?: (id: string, name: string) => void | Promise<void>
  onSelectedTopicIdsChange?: (ids: string[]) => void
  onTopicSelect?: (topic: Topic) => void
}

const HistoryTopicResultList = ({
  topics,
  assistantById,
  unlinkedAssistantLabel,
  isLoading = false,
  isTopicPinned = () => false,
  selectedTopicIds = [],
  onToggleTopicPin,
  topicMenuPreset,
  onTopicRename,
  onSelectedTopicIdsChange,
  onTopicSelect
}: HistoryTopicResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)
  const emptyTitle = isLoading ? t('history.records.loading.title') : t('history.records.empty.title')
  const emptyDescription = isLoading ? t('history.records.loading.description') : t('history.records.empty.description')
  const emptyContent = (
    <div className="flex min-h-[320px] items-center justify-center px-5 py-8">
      <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
    </div>
  )
  const getTopicMenuContextOverride = useCallback(
    (topic: Topic): TopicMenuActionContextOverride => ({
      onStartRename: () =>
        setRenameTarget({
          id: topic.id,
          name: topic.name ?? ''
        })
    }),
    []
  )
  const handleRenameSubmit = useCallback(
    (name: string) => {
      if (!renameTarget) return
      void onTopicRename?.(renameTarget.id, name)
    },
    [onTopicRename, renameTarget]
  )
  const handleRenameOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTarget(null)
    }
  }, [])

  const selectedTopicIdSet = useMemo(() => new Set(selectedTopicIds.map(String)), [selectedTopicIds])
  const selectableTopicIds = useMemo(
    () => topicList.filter((topic) => !isTopicPinned(topic.id)).map((topic) => topic.id),
    [isTopicPinned, topicList]
  )
  const selectedTopicCount = useMemo(
    () => selectableTopicIds.filter((id) => selectedTopicIdSet.has(id)).length,
    [selectableTopicIds, selectedTopicIdSet]
  )
  const handleToggleTopicAll = useCallback(
    (checked: boolean) => onSelectedTopicIdsChange?.(checked ? selectableTopicIds : []),
    [onSelectedTopicIdsChange, selectableTopicIds]
  )
  const handleToggleTopicSelection = useCallback(
    (topicId: string, checked: boolean) => {
      if (checked && isTopicPinned(topicId)) return

      const keys = selectedTopicIds.map(String)
      onSelectedTopicIdsChange?.(
        checked ? (keys.includes(topicId) ? keys : [...keys, topicId]) : keys.filter((key) => key !== topicId)
      )
    },
    [isTopicPinned, onSelectedTopicIdsChange, selectedTopicIds]
  )
  const topicHeader = (
    <HistoryTableHeader
      actionsLabel={t('history.records.table.actions')}
      selectAllLabel={t('common.select_all')}
      selectedState={
        selectableTopicIds.length > 0 && selectedTopicCount === selectableTopicIds.length
          ? true
          : selectedTopicCount > 0
            ? 'indeterminate'
            : false
      }
      selectionDisabled={selectableTopicIds.length === 0}
      sourceLabel={t('common.assistant')}
      showFixedActionShadow={showFixedActionShadow}
      timeLabel={t('history.records.table.time')}
      titleLabel={t('history.records.table.title')}
      onToggleAll={handleToggleTopicAll}
    />
  )

  const renderTopicRowContextMenu = useCallback(
    (topic: Topic, _index: number, row: ReactElement) => {
      if (!topicMenuPreset) return row

      const contextOverride = getTopicMenuContextOverride(topic)
      const actions = topicMenuPreset.getActions(topic, contextOverride)
      if (!actions.length) return row

      return (
        <HistoryActionContextMenu
          actions={actions}
          className="z-50"
          onAction={(action) => topicMenuPreset.onAction(topic, action, contextOverride)}>
          {row}
        </HistoryActionContextMenu>
      )
    },
    [getTopicMenuContextOverride, topicMenuPreset]
  )

  const renderTopicRow = useCallback(
    (topic: Topic, index: number) => {
      const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
      const contextOverride = getTopicMenuContextOverride(topic)
      const actions = topicMenuPreset?.getActions(topic, contextOverride) ?? []
      const isPinned = isTopicPinned(topic.id)
      const row = (
        <HistoryTopicRow
          actions={actions}
          assistant={assistant}
          isPinned={isPinned}
          isSelected={!isPinned && selectedTopicIdSet.has(topic.id)}
          deleteLabel={t('common.delete')}
          pinLabel={t('chat.topics.pin')}
          selectLabel={`${t('common.select')} ${topic.name || t('chat.default.topic.name')}`}
          showFixedActionShadow={showFixedActionShadow}
          sourceName={assistant?.name ?? unlinkedAssistantLabel}
          timeLabel={formatHistoryTime(topic.updatedAt, t)}
          title={topic.name || t('chat.default.topic.name')}
          unpinLabel={t('chat.topics.unpin')}
          onAction={(action) => topicMenuPreset?.onAction(topic, action, contextOverride)}
          onOpen={() => onTopicSelect?.(topic)}
          onSelectedChange={(checked) => handleToggleTopicSelection(topic.id, checked)}
          onTogglePin={() => onToggleTopicPin?.(topic)}
        />
      )

      return renderTopicRowContextMenu(topic, index, row)
    },
    [
      assistantById,
      getTopicMenuContextOverride,
      handleToggleTopicSelection,
      isTopicPinned,
      onToggleTopicPin,
      onTopicSelect,
      renderTopicRowContextMenu,
      selectedTopicIdSet,
      showFixedActionShadow,
      t,
      topicMenuPreset,
      unlinkedAssistantLabel
    ]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <HistoryVirtualTable
        emptyContent={emptyContent}
        estimateSize={() => 44}
        header={topicHeader}
        items={topicList}
        onFixedActionShadowChange={setShowFixedActionShadow}
        renderRow={renderTopicRow}
      />
      <EditNameDialog
        open={!!renameTarget}
        title={t('chat.topics.edit.title')}
        initialName={renameTarget?.name ?? ''}
        onSubmit={handleRenameSubmit}
        onOpenChange={handleRenameOpenChange}
      />
    </div>
  )
}

interface HistoryTopicRowProps {
  actions: readonly ResolvedAction[]
  assistant?: Assistant
  deleteLabel: string
  isPinned: boolean
  isSelected: boolean
  pinLabel: string
  selectLabel: string
  showFixedActionShadow: boolean
  sourceName: string
  timeLabel: string
  title: string
  unpinLabel: string
  onAction: (action: ResolvedAction) => void | Promise<void>
  onOpen?: () => void
  onSelectedChange: (checked: boolean) => void
  onTogglePin?: () => void | Promise<void>
}

const HistoryTopicRow = ({
  actions,
  assistant,
  deleteLabel,
  isPinned,
  isSelected,
  pinLabel,
  selectLabel,
  showFixedActionShadow,
  sourceName,
  timeLabel,
  title,
  unpinLabel,
  onAction,
  onOpen,
  onSelectedChange,
  onTogglePin
}: HistoryTopicRowProps) => (
  <div
    className={cn(historyTableGridClassName, historyBodyRowClassName, 'min-h-11')}
    data-state={isSelected ? 'selected' : undefined}
    role="row">
    <HistorySelectionCell
      checked={isSelected}
      disabled={isPinned}
      label={selectLabel}
      onCheckedChange={onSelectedChange}
    />
    <div className={historyBodyCellClassName} role="cell">
      <RowFlex className="min-w-0 flex-1 items-center" data-testid="history-topic-rename-field">
        <HistoryTitleButton title={title} onOpen={onOpen} />
      </RowFlex>
    </div>
    <div className={historyBodyCellClassName} role="cell">
      <RowFlex className="min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
          {assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} />}
        </span>
        <span className="truncate text-foreground-secondary text-xs">{sourceName}</span>
      </RowFlex>
    </div>
    <div className={historyBodyCellClassName} role="cell">
      <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
    </div>
    <div
      className={cn(
        historyBodyCellClassName,
        historyFixedActionCellClassName,
        showFixedActionShadow && historyFixedActionShadowClassName
      )}
      role="cell">
      <HistoryActionsCell
        actions={actions}
        deleteLabel={deleteLabel}
        isPinned={isPinned}
        pinLabel={pinLabel}
        unpinLabel={unpinLabel}
        onAction={onAction}
        onTogglePin={onTogglePin}
      />
    </div>
  </div>
)

export default HistoryTopicResultList
