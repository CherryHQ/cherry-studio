import { Button, Checkbox, EmptyState, RowFlex } from '@cherrystudio/ui'
import { ActionConfirmDialog } from '@renderer/components/chat/actions/ActionConfirmDialog'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/features/command'
import type {
  SessionMenuActionContextOverride,
  SessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
import type {
  TopicMenuActionContextOverride,
  TopicMenuPreset
} from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import dayjs from 'dayjs'
import { Bot, MessageSquareText, PinIcon, Trash2, Wrench } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface HistoryResultListProps {
  mode: HistoryRecordsMode
  topics: readonly Topic[]
  sessions: readonly AgentSessionEntity[]
  assistantById: ReadonlyMap<string, Assistant>
  agentById: ReadonlyMap<string, AgentEntity>
  unlinkedAssistantLabel: string
  isLoading?: boolean
  isSessionPinned?: (sessionId: string) => boolean
  isTopicPinned?: (topicId: string) => boolean
  selectedSessionIds?: readonly string[]
  selectedTopicIds?: readonly string[]
  onToggleSessionPin?: (sessionId: string) => void | Promise<void>
  onToggleTopicPin?: (topic: Topic) => void | Promise<void>
  topicMenuPreset?: TopicMenuPreset<Topic>
  sessionMenuPreset?: SessionMenuPreset<AgentSessionEntity>
  onTopicRename?: (id: string, name: string) => void | Promise<void>
  onSessionRename?: (id: string, name: string) => void | Promise<void>
  onSelectedSessionIdsChange?: (ids: string[]) => void
  onSelectedTopicIdsChange?: (ids: string[]) => void
  onTopicSelect?: (topic: Topic) => void
  onSessionSelect?: (sessionId: string) => void
}

type RenameTarget =
  | {
      type: 'topic'
      id: string
      name: string
    }
  | {
      type: 'session'
      id: string
      name: string
    }

const historyTableClassName = 'min-w-[760px] rounded-none border-0 bg-card shadow-none'
const historyTableGridClassName = 'grid min-w-[760px] grid-cols-[44px_minmax(284px,1fr)_160px_96px_76px]'
const historyHeaderClassName =
  'sticky top-0 z-10 border-border-muted border-b bg-card text-muted-foreground text-xs leading-4'
const historyHeaderCellClassName = 'flex h-10 min-w-0 items-center px-3 py-2 font-semibold'
const historyBodyRowClassName =
  'border-border-subtle border-b bg-card text-foreground-secondary text-sm leading-5 transition-colors hover:bg-muted/45 data-[state=selected]:bg-muted/60'
const historyBodyCellClassName = 'flex min-w-0 items-center px-3 py-2.5'
const historyFixedActionCellClassName =
  'sticky right-0 z-2 justify-center bg-inherit px-2 [border-left:0.5px_solid_var(--color-border-subtle)]'
const historyFixedActionShadowClassName = 'shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]'

const HistoryResultList = ({
  mode,
  topics,
  sessions,
  assistantById,
  agentById,
  unlinkedAssistantLabel,
  isLoading = false,
  isSessionPinned = () => false,
  isTopicPinned = () => false,
  selectedSessionIds = [],
  selectedTopicIds = [],
  onToggleSessionPin,
  onToggleTopicPin,
  topicMenuPreset,
  sessionMenuPreset,
  onTopicRename,
  onSessionRename,
  onSelectedSessionIdsChange,
  onSelectedTopicIdsChange,
  onTopicSelect,
  onSessionSelect
}: HistoryResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const sessionList = useMemo(() => Array.from(sessions), [sessions])
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)
  const emptyTitle = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.title')
      : t('history.records.loading.sessionsTitle')
    : mode === 'assistant'
      ? t('history.records.empty.title')
      : t('history.records.empty.sessionsTitle')
  const emptyDescription = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.description')
      : t('history.records.loading.sessionsDescription')
    : mode === 'assistant'
      ? t('history.records.empty.description')
      : t('history.records.empty.sessionsDescription')
  const emptyContent = (
    <div className="flex min-h-[320px] items-center justify-center px-5 py-8">
      <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
    </div>
  )
  const getTopicMenuContextOverride = useCallback(
    (topic: Topic): TopicMenuActionContextOverride => ({
      onStartRename: () =>
        setRenameTarget({
          type: 'topic',
          id: topic.id,
          name: topic.name ?? ''
        })
    }),
    []
  )
  const getSessionMenuContextOverride = useCallback(
    (session: AgentSessionEntity): SessionMenuActionContextOverride => ({
      startEdit: () =>
        setRenameTarget({
          type: 'session',
          id: session.id,
          name: session.name ?? ''
        })
    }),
    []
  )
  const handleRenameSubmit = useCallback(
    (name: string) => {
      if (!renameTarget) return

      if (renameTarget.type === 'topic') {
        void onTopicRename?.(renameTarget.id, name)
        return
      }

      void onSessionRename?.(renameTarget.id, name)
    },
    [onSessionRename, onTopicRename, renameTarget]
  )
  const handleRenameOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTarget(null)
    }
  }, [])

  const selectedTopicIdSet = useMemo(() => new Set(selectedTopicIds.map(String)), [selectedTopicIds])
  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds.map(String)), [selectedSessionIds])
  const selectedTopicCount = useMemo(
    () => topicList.filter((topic) => selectedTopicIdSet.has(topic.id)).length,
    [selectedTopicIdSet, topicList]
  )
  const selectedSessionCount = useMemo(
    () => sessionList.filter((session) => selectedSessionIdSet.has(session.id)).length,
    [selectedSessionIdSet, sessionList]
  )
  const handleToggleTopicAll = useCallback(
    (checked: boolean) => onSelectedTopicIdsChange?.(checked ? topicList.map((topic) => topic.id) : []),
    [onSelectedTopicIdsChange, topicList]
  )
  const handleToggleSessionAll = useCallback(
    (checked: boolean) => onSelectedSessionIdsChange?.(checked ? sessionList.map((session) => session.id) : []),
    [onSelectedSessionIdsChange, sessionList]
  )
  const handleToggleTopicSelection = useCallback(
    (topicId: string, checked: boolean) => {
      const keys = selectedTopicIds.map(String)
      onSelectedTopicIdsChange?.(
        checked ? (keys.includes(topicId) ? keys : [...keys, topicId]) : keys.filter((key) => key !== topicId)
      )
    },
    [onSelectedTopicIdsChange, selectedTopicIds]
  )
  const handleToggleSessionSelection = useCallback(
    (sessionId: string, checked: boolean) => {
      const keys = selectedSessionIds.map(String)
      onSelectedSessionIdsChange?.(
        checked ? (keys.includes(sessionId) ? keys : [...keys, sessionId]) : keys.filter((key) => key !== sessionId)
      )
    },
    [onSelectedSessionIdsChange, selectedSessionIds]
  )
  const topicHeader = (
    <HistoryTableHeader
      actionsLabel={t('history.records.table.actions')}
      selectAllLabel={t('common.select_all')}
      selectedState={
        topicList.length > 0 && selectedTopicCount === topicList.length
          ? true
          : selectedTopicCount > 0
            ? 'indeterminate'
            : false
      }
      sourceLabel={t('common.assistant')}
      showFixedActionShadow={showFixedActionShadow}
      timeLabel={t('history.records.table.time')}
      titleLabel={t('history.records.table.title')}
      onToggleAll={handleToggleTopicAll}
    />
  )
  const sessionHeader = (
    <HistoryTableHeader
      actionsLabel={t('history.records.table.actions')}
      selectAllLabel={t('common.select_all')}
      selectedState={
        sessionList.length > 0 && selectedSessionCount === sessionList.length
          ? true
          : selectedSessionCount > 0
            ? 'indeterminate'
            : false
      }
      sourceLabel={t('common.agent')}
      showFixedActionShadow={showFixedActionShadow}
      timeLabel={t('history.records.table.time')}
      titleLabel={t('history.records.table.session')}
      onToggleAll={handleToggleSessionAll}
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

  const renderSessionRowContextMenu = useCallback(
    (session: AgentSessionEntity, _index: number, row: ReactElement) => {
      if (!sessionMenuPreset) return row

      const contextOverride = getSessionMenuContextOverride(session)
      const actions = sessionMenuPreset.getActions(session, contextOverride)
      if (!actions.length) return row

      return (
        <HistoryActionContextMenu
          actions={actions}
          className="z-50"
          onAction={(action) => sessionMenuPreset.onAction(session, action, contextOverride)}>
          {row}
        </HistoryActionContextMenu>
      )
    },
    [getSessionMenuContextOverride, sessionMenuPreset]
  )

  const renderTopicRow = useCallback(
    (topic: Topic, index: number) => {
      const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
      const contextOverride = getTopicMenuContextOverride(topic)
      const actions = topicMenuPreset?.getActions(topic, contextOverride) ?? []
      const row = (
        <HistoryTopicRow
          actions={actions}
          assistant={assistant}
          isPinned={isTopicPinned(topic.id)}
          isSelected={selectedTopicIdSet.has(topic.id)}
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
  const renderSessionRow = useCallback(
    (session: AgentSessionEntity, index: number) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      const contextOverride = getSessionMenuContextOverride(session)
      const actions = sessionMenuPreset?.getActions(session, contextOverride) ?? []
      const row = (
        <HistorySessionRow
          actions={actions}
          agent={agent}
          isPinned={isSessionPinned(session.id)}
          isSelected={selectedSessionIdSet.has(session.id)}
          deleteLabel={t('common.delete')}
          pinLabel={t('selector.common.pin')}
          selectLabel={`${t('common.select')} ${session.name || t('common.unnamed')}`}
          session={session}
          showFixedActionShadow={showFixedActionShadow}
          sourceName={agent?.name ?? t('common.unknown')}
          timeLabel={formatHistoryTime(session.updatedAt, t)}
          title={session.name || t('common.unnamed')}
          unpinLabel={t('selector.common.unpin')}
          onAction={(action) => sessionMenuPreset?.onAction(session, action, contextOverride)}
          onOpen={() => onSessionSelect?.(session.id)}
          onSelectedChange={(checked) => handleToggleSessionSelection(session.id, checked)}
          onTogglePin={() => onToggleSessionPin?.(session.id)}
        />
      )

      return renderSessionRowContextMenu(session, index, row)
    },
    [
      agentById,
      getSessionMenuContextOverride,
      handleToggleSessionSelection,
      isSessionPinned,
      onToggleSessionPin,
      onSessionSelect,
      renderSessionRowContextMenu,
      selectedSessionIdSet,
      sessionMenuPreset,
      showFixedActionShadow,
      t
    ]
  )

  const renameDialogTitle = renameTarget?.type === 'topic' ? t('chat.topics.edit.title') : t('agent.session.edit.title')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      {mode === 'assistant' ? (
        <HistoryVirtualTable
          emptyContent={emptyContent}
          estimateSize={() => 44}
          header={topicHeader}
          items={topicList}
          onFixedActionShadowChange={setShowFixedActionShadow}
          renderRow={renderTopicRow}
        />
      ) : (
        <HistoryVirtualTable
          emptyContent={emptyContent}
          estimateSize={() => 52}
          header={sessionHeader}
          items={sessionList}
          onFixedActionShadowChange={setShowFixedActionShadow}
          renderRow={renderSessionRow}
        />
      )}
      <EditNameDialog
        open={!!renameTarget}
        title={renameDialogTitle}
        initialName={renameTarget?.name ?? ''}
        onSubmit={handleRenameSubmit}
        onOpenChange={handleRenameOpenChange}
      />
    </div>
  )
}

interface HistoryVirtualTableProps<TItem> {
  emptyContent: ReactNode
  estimateSize: (index: number) => number
  header: ReactNode
  items: TItem[]
  onFixedActionShadowChange: (showShadow: boolean) => void
  renderRow: (item: TItem, index: number) => ReactNode
}

function HistoryVirtualTable<TItem>({
  emptyContent,
  estimateSize,
  header,
  items,
  onFixedActionShadowChange,
  renderRow
}: HistoryVirtualTableProps<TItem>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const updateFixedActionShadow = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      onFixedActionShadowChange(false)
      return
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    onFixedActionShadowChange(maxScrollLeft > 1 && scroller.scrollLeft < maxScrollLeft - 1)
  }, [onFixedActionShadowChange])

  useEffect(() => {
    updateFixedActionShadow()

    const scroller = scrollerRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(updateFixedActionShadow)
    resizeObserver.observe(scroller)
    if (scroller.firstElementChild) {
      resizeObserver.observe(scroller.firstElementChild)
    }

    return () => resizeObserver.disconnect()
  }, [header, items.length, updateFixedActionShadow])

  return (
    <div className="min-h-0 flex-1 px-3 py-3" role="table">
      <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', historyTableClassName)}>
        {items.length > 0 ? (
          <DynamicVirtualList
            autoHideScrollbar
            className="min-h-0 flex-1"
            estimateSize={estimateSize}
            header={header}
            list={items}
            onScroll={updateFixedActionShadow}
            overscan={8}
            role="rowgroup"
            scrollElementRef={scrollerRef}
            scrollerStyle={{ overflowX: 'auto' }}>
            {renderRow}
          </DynamicVirtualList>
        ) : (
          <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto" onScroll={updateFixedActionShadow}>
            {header}
            {emptyContent}
          </div>
        )}
      </div>
    </div>
  )
}

interface HistoryTableHeaderProps {
  actionsLabel: string
  selectAllLabel: string
  selectedState: boolean | 'indeterminate'
  showFixedActionShadow: boolean
  sourceLabel: string
  timeLabel: string
  titleLabel: string
  onToggleAll: (checked: boolean) => void
}

const HistoryTableHeader = ({
  actionsLabel,
  selectAllLabel,
  selectedState,
  showFixedActionShadow,
  sourceLabel,
  timeLabel,
  titleLabel,
  onToggleAll
}: HistoryTableHeaderProps) => (
  <div className={cn(historyTableGridClassName, historyHeaderClassName)} role="row">
    <div className={cn(historyHeaderCellClassName, 'justify-center px-2')} role="columnheader">
      <Checkbox
        size="sm"
        checked={selectedState}
        aria-label={selectAllLabel}
        onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {titleLabel}
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {sourceLabel}
    </div>
    <div className={historyHeaderCellClassName} role="columnheader">
      {timeLabel}
    </div>
    <div
      className={cn(
        historyHeaderCellClassName,
        historyFixedActionCellClassName,
        showFixedActionShadow && historyFixedActionShadowClassName
      )}
      role="columnheader">
      {actionsLabel}
    </div>
  </div>
)

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
    <HistorySelectionCell checked={isSelected} label={selectLabel} onCheckedChange={onSelectedChange} />
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

interface HistorySessionRowProps {
  actions: readonly ResolvedAction[]
  agent?: AgentEntity
  deleteLabel: string
  isPinned: boolean
  isSelected: boolean
  pinLabel: string
  selectLabel: string
  session: AgentSessionEntity
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

const HistorySessionRow = ({
  actions,
  agent,
  deleteLabel,
  isPinned,
  isSelected,
  pinLabel,
  selectLabel,
  session,
  showFixedActionShadow,
  sourceName,
  timeLabel,
  title,
  unpinLabel,
  onAction,
  onOpen,
  onSelectedChange,
  onTogglePin
}: HistorySessionRowProps) => {
  const avatar = agent?.configuration?.avatar?.trim()

  return (
    <div
      className={cn(historyTableGridClassName, historyBodyRowClassName, 'min-h-13')}
      data-state={isSelected ? 'selected' : undefined}
      role="row">
      <HistorySelectionCell checked={isSelected} label={selectLabel} onCheckedChange={onSelectedChange} />
      <div className={historyBodyCellClassName} role="cell">
        <RowFlex className="min-w-0 flex-1 items-center">
          <div className="min-w-0 flex-1" data-testid="history-session-rename-field">
            <RowFlex className="min-w-0 flex-1 items-center gap-1.5">
              <HistoryTitleButton title={title} onOpen={onOpen} />
            </RowFlex>
            {session.description && (
              <span className="mt-0.5 block truncate text-foreground-muted text-xs leading-4">
                {session.description}
              </span>
            )}
          </div>
        </RowFlex>
      </div>
      <div className={historyBodyCellClassName} role="cell">
        <RowFlex className="min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
            {avatar ? <span aria-hidden>{avatar}</span> : <Wrench size={14} />}
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
}

interface HistorySelectionCellProps {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

const HistorySelectionCell = ({ checked, label, onCheckedChange }: HistorySelectionCellProps) => (
  <div className={cn(historyBodyCellClassName, 'justify-center px-2')} role="cell">
    <Checkbox
      size="sm"
      checked={checked}
      aria-label={label}
      onCheckedChange={(nextChecked) => onCheckedChange(Boolean(nextChecked))}
      onClick={(event) => event.stopPropagation()}
    />
  </div>
)

interface HistoryTitleButtonProps {
  title: string
  onOpen?: () => void
}

const HistoryTitleButton = ({ title, onOpen }: HistoryTitleButtonProps) => (
  <span
    role="button"
    tabIndex={0}
    className="-mx-1 block w-full min-w-0 max-w-full cursor-pointer truncate rounded-sm px-1 py-0 text-left font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
    title={title}
    onClick={(event) => {
      event.stopPropagation()
      onOpen?.()
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      onOpen?.()
    }}>
    {title}
  </span>
)

interface HistoryActionContextMenuProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  children: ReactElement
  className?: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
}

function HistoryActionContextMenu<TContext = unknown>({
  actions,
  children,
  className,
  onAction
}: HistoryActionContextMenuProps<TContext>) {
  const runAction = useCallback(
    (action: ResolvedAction<TContext>) => {
      if (!action.availability.enabled) return
      const confirm = action.confirm
      if (confirm) {
        void window.modal.confirm({
          title: confirm.title,
          content: confirm.description ?? confirm.content,
          okText: confirm.confirmText,
          cancelText: confirm.cancelText,
          centered: true,
          okButtonProps: confirm.destructive ? { danger: true } : undefined,
          onOk: () => onAction(action)
        })
        return
      }
      window.requestAnimationFrame(() => void onAction(action))
    },
    [onAction]
  )

  const extraItems = useMemo<CommandContextMenuExtraItem[]>(() => {
    const toItems = (list: readonly ResolvedAction<TContext>[]): CommandContextMenuExtraItem[] => {
      const items: CommandContextMenuExtraItem[] = []
      let previousGroup: string | undefined
      for (const action of list) {
        if (!action.availability.visible) continue
        if (items.length > 0 && action.group !== previousGroup) {
          items.push({ type: 'separator' })
        }
        previousGroup = action.group
        if (action.children.length > 0) {
          items.push({
            type: 'submenu',
            id: action.id,
            label: action.label as string,
            icon: action.icon,
            enabled: action.availability.enabled,
            children: toItems(action.children)
          })
        } else {
          items.push({
            type: 'item',
            id: action.id,
            label: action.label as string,
            icon: action.icon,
            enabled: action.availability.enabled,
            destructive: action.danger,
            shortcutLabel: action.shortcut,
            onSelect: () => runAction(action)
          })
        }
      }
      return items
    }
    return toItems(actions)
  }, [actions, runAction])

  return (
    <CommandContextMenu location="webcontents.context" extraItems={extraItems} contentClassName={className}>
      {children}
    </CommandContextMenu>
  )
}

interface HistoryActionsCellProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  deleteLabel: string
  isPinned: boolean
  pinLabel: string
  unpinLabel: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
}

function HistoryActionsCell<TContext = unknown>({
  actions,
  deleteLabel,
  isPinned,
  pinLabel,
  unpinLabel,
  onAction,
  onTogglePin
}: HistoryActionsCellProps<TContext>) {
  const [pendingDeleteAction, setPendingDeleteAction] = useState<ResolvedAction<TContext> | undefined>()
  const deleteAction = useMemo(() => actions.find(isDeleteAction), [actions])
  const handleAction = useCallback(
    (action: ResolvedAction<TContext>) => {
      window.requestAnimationFrame(() => {
        void onAction(action)
      })
    },
    [onAction]
  )

  return (
    <>
      <RowFlex className="items-center justify-center gap-1" onClick={(event) => event.stopPropagation()}>
        <PinActionButton isPinned={isPinned} pinLabel={pinLabel} unpinLabel={unpinLabel} onClick={onTogglePin} />
        <DeleteActionButton
          action={deleteAction}
          label={deleteLabel}
          onClick={(action) => {
            if (action.confirm) {
              setPendingDeleteAction(action)
              return
            }
            handleAction(action)
          }}
        />
      </RowFlex>
      <ActionConfirmDialog
        open={!!pendingDeleteAction}
        confirm={pendingDeleteAction?.confirm}
        contentClassName="z-50"
        overlayClassName="z-40"
        onOpenChange={(open) => {
          if (!open) setPendingDeleteAction(undefined)
        }}
        onConfirm={async () => {
          if (!pendingDeleteAction) return
          handleAction(pendingDeleteAction)
          setPendingDeleteAction(undefined)
        }}
      />
    </>
  )
}

function isDeleteAction<TContext>(action: ResolvedAction<TContext>) {
  return action.id.endsWith('.delete') || action.commandId?.endsWith('.delete')
}

interface DeleteActionButtonProps<TContext = unknown> {
  action?: ResolvedAction<TContext>
  label: string
  onClick: (action: ResolvedAction<TContext>) => void
}

const DeleteActionButton = <TContext,>({ action, label, onClick }: DeleteActionButtonProps<TContext>) => {
  const disabled = !action?.availability.enabled

  return (
    <Button
      type="button"
      aria-label={label}
      className="text-foreground/70 hover:bg-accent/70 hover:text-foreground"
      data-testid="history-delete-button"
      disabled={disabled}
      size="icon-sm"
      title={label}
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation()
        if (action) onClick(action)
      }}>
      <Trash2 className="size-4" />
    </Button>
  )
}

interface PinActionButtonProps {
  isPinned: boolean
  pinLabel: string
  unpinLabel: string
  onClick?: () => void | Promise<void>
}

const PinActionButton = ({ isPinned, pinLabel, unpinLabel, onClick }: PinActionButtonProps) => {
  const label = isPinned ? unpinLabel : pinLabel

  return (
    <Button
      type="button"
      aria-label={label}
      className="text-foreground/70 hover:bg-accent/70 hover:text-foreground"
      data-testid="history-pin-button"
      size="icon-sm"
      title={label}
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation()
        void onClick?.()
      }}>
      <PinIcon size={14} className={cn(isPinned && '-rotate-45')} />
    </Button>
  )
}

function formatHistoryTime(value: string, t: ReturnType<typeof useTranslation>['t']) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.records.table.emptyValue')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}

export default HistoryResultList
