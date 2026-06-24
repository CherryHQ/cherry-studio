import { EmptyState, RowFlex } from '@cherrystudio/ui'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import EditNameDialog from '@renderer/components/EditNameDialog'
import EmojiIcon from '@renderer/components/EmojiIcon'
import type {
  SessionMenuActionContextOverride,
  SessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import { cn } from '@renderer/utils'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { MessageSquareText } from 'lucide-react'
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

interface HistorySessionResultListProps {
  sessions: readonly AgentSessionEntity[]
  agentById: ReadonlyMap<string, AgentEntity>
  isLoading?: boolean
  isSessionPinned?: (sessionId: string) => boolean
  selectedSessionIds?: readonly string[]
  onToggleSessionPin?: (sessionId: string) => void | Promise<void>
  sessionMenuPreset?: SessionMenuPreset<AgentSessionEntity>
  onSessionRename?: (id: string, name: string) => void | Promise<void>
  onSelectedSessionIdsChange?: (ids: string[]) => void
  onSessionSelect?: (sessionId: string) => void
}

const HistorySessionResultList = ({
  sessions,
  agentById,
  isLoading = false,
  isSessionPinned = () => false,
  selectedSessionIds = [],
  onToggleSessionPin,
  sessionMenuPreset,
  onSessionRename,
  onSelectedSessionIdsChange,
  onSessionSelect
}: HistorySessionResultListProps) => {
  const { t } = useTranslation()
  const sessionList = useMemo(() => Array.from(sessions), [sessions])
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [showFixedActionShadow, setShowFixedActionShadow] = useState(false)
  const emptyTitle = isLoading ? t('history.records.loading.sessionsTitle') : t('history.records.empty.sessionsTitle')
  const emptyDescription = isLoading
    ? t('history.records.loading.sessionsDescription')
    : t('history.records.empty.sessionsDescription')
  const emptyContent = (
    <div className="flex min-h-[320px] items-center justify-center px-5 py-8">
      <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
    </div>
  )
  const getSessionMenuContextOverride = useCallback(
    (session: AgentSessionEntity): SessionMenuActionContextOverride => ({
      startEdit: () =>
        setRenameTarget({
          id: session.id,
          name: session.name ?? ''
        })
    }),
    []
  )
  const handleRenameSubmit = useCallback(
    (name: string) => {
      if (!renameTarget) return
      void onSessionRename?.(renameTarget.id, name)
    },
    [onSessionRename, renameTarget]
  )
  const handleRenameOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTarget(null)
    }
  }, [])

  const selectedSessionIdSet = useMemo(() => new Set(selectedSessionIds.map(String)), [selectedSessionIds])
  const selectableSessionIds = useMemo(
    () => sessionList.filter((session) => !isSessionPinned(session.id)).map((session) => session.id),
    [isSessionPinned, sessionList]
  )
  const selectedSessionCount = useMemo(
    () => selectableSessionIds.filter((id) => selectedSessionIdSet.has(id)).length,
    [selectableSessionIds, selectedSessionIdSet]
  )
  const handleToggleSessionAll = useCallback(
    (checked: boolean) => onSelectedSessionIdsChange?.(checked ? selectableSessionIds : []),
    [onSelectedSessionIdsChange, selectableSessionIds]
  )
  const handleToggleSessionSelection = useCallback(
    (sessionId: string, checked: boolean) => {
      if (checked && isSessionPinned(sessionId)) return

      const keys = selectedSessionIds.map(String)
      onSelectedSessionIdsChange?.(
        checked ? (keys.includes(sessionId) ? keys : [...keys, sessionId]) : keys.filter((key) => key !== sessionId)
      )
    },
    [isSessionPinned, onSelectedSessionIdsChange, selectedSessionIds]
  )
  const sessionHeader = (
    <HistoryTableHeader
      actionsLabel={t('history.records.table.actions')}
      selectAllLabel={t('common.select_all')}
      selectedState={
        selectableSessionIds.length > 0 && selectedSessionCount === selectableSessionIds.length
          ? true
          : selectedSessionCount > 0
            ? 'indeterminate'
            : false
      }
      selectionDisabled={selectableSessionIds.length === 0}
      sourceLabel={t('common.agent')}
      showFixedActionShadow={showFixedActionShadow}
      timeLabel={t('history.records.table.time')}
      titleLabel={t('history.records.table.session')}
      onToggleAll={handleToggleSessionAll}
    />
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

  const renderSessionRow = useCallback(
    (session: AgentSessionEntity, index: number) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      const contextOverride = getSessionMenuContextOverride(session)
      const actions = sessionMenuPreset?.getActions(session, contextOverride) ?? []
      const isPinned = isSessionPinned(session.id)
      const row = (
        <HistorySessionRow
          actions={actions}
          agent={agent}
          isPinned={isPinned}
          isSelected={!isPinned && selectedSessionIdSet.has(session.id)}
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <HistoryVirtualTable
        emptyContent={emptyContent}
        estimateSize={() => 52}
        header={sessionHeader}
        items={sessionList}
        onFixedActionShadowChange={setShowFixedActionShadow}
        renderRow={renderSessionRow}
      />
      <EditNameDialog
        open={!!renameTarget}
        title={t('agent.session.edit.title')}
        initialName={renameTarget?.name ?? ''}
        onSubmit={handleRenameSubmit}
        onOpenChange={handleRenameOpenChange}
      />
    </div>
  )
}

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
  const avatar = getAgentAvatarFromConfiguration(agent?.configuration)

  return (
    <div
      className={cn(historyTableGridClassName, historyBodyRowClassName, 'min-h-13')}
      data-state={isSelected ? 'selected' : undefined}
      role="row">
      <HistorySelectionCell
        checked={isSelected}
        disabled={isPinned}
        label={selectLabel}
        onCheckedChange={onSelectedChange}
      />
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
          <span className="flex size-5 shrink-0 items-center justify-center">
            <EmojiIcon emoji={avatar} size={20} fontSize={12} className="mr-0 text-foreground" />
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

export default HistorySessionResultList
