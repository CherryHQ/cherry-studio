import dayjs from 'dayjs'
import { FilePenLine, PinIcon, Archive } from 'lucide-react'
import type { RefObject } from 'react'
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Kbd, Tooltip } from '@cherrystudio/ui'
import { useSharedCacheSelector } from '@data/hooks/useCache'
import { ResourceListActionContextMenu } from '@renderer/components/chat/actions/ResourceListActionContextMenu'
import type {
  TopicExportMenuOptions,
  TopicMoveAssistantTarget
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { useTopicMenuActions } from '@renderer/components/chat/actions/useTopicMenuActions'
import { useOptionalRightPanelActions, useOptionalRightPanelState } from '@renderer/components/chat/panes/Shell'
import {
  CONVERSATION_ROW_STATUS_TITLE_CLASS,
  ConversationRowStatus,
  type ConversationRowStatusValue,
  ResourceList,
  useResourceListActions,
  useResourceListRowState
} from '@renderer/components/chat/resourceList/base'
import { SessionHoverPreview } from '@renderer/components/chat/resourceList/SessionHoverPreview'
import { useConversationListShortcuts } from '@renderer/components/chat/resourceList/useConversationListShortcuts'
import {
  readChatDraftPresence,
  subscribeChatDraftCache
} from '@renderer/components/composer/variants/chat/chatDraftCache'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { useTopicRenameState } from '@renderer/hooks/chat/useTopicRenameState'
import type { Topic } from '@renderer/types/topic'
import type { TopicDisplayMode } from '@renderer/utils/chat/topicsHelpers'
import { cn } from '@renderer/utils/style'
import { classifyTurn, type TopicStatusSnapshotEntry } from '@shared/ai/transport'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import type { TopicImageActionType } from '../../../messages/topicImageActionBus'

export type TopicListBodyVariant = 'draggable' | 'plain'
type TopicStreamState = {
  isAwaitingApproval: boolean
  isErrored: boolean
  isFulfilled: boolean
  isPending: boolean
}

const EMPTY_TOPIC_STREAM_STATE: TopicStreamState = Object.freeze({
  isAwaitingApproval: false,
  isErrored: false,
  isFulfilled: false,
  isPending: false
})

const getTopicStreamStatusCacheKey = (topicId: string) => `topic.stream.statuses.${topicId}` as const

const getTopicStreamLastSeenCompletionCacheKey = (topicId: string) =>
  `topic.stream.last_seen_completion.${topicId}` as const

const selectTopicStreamState = (
  values: readonly [TopicStatusSnapshotEntry | null | undefined, number | null | undefined]
): TopicStreamState => {
  const [statusEntry, lastSeenCompletion] = values
  const status = statusEntry?.status
  const lastCompletedAt = statusEntry?.lastCompletedAt ?? null
  const flags = classifyTurn(status)
  const streamStatus = {
    isAwaitingApproval: flags.isAwaitingApproval || (statusEntry?.awaitingApprovalAnchors.length ?? 0) > 0,
    isErrored: status === 'error',
    isFulfilled: status === 'done' && lastCompletedAt !== lastSeenCompletion,
    isPending: flags.isStreamLive
  }

  // Normalize the idle case to a module constant; the non-idle object is
  // rebuilt per run and bails out via the default shallowEqual.
  return streamStatus.isAwaitingApproval || streamStatus.isPending || streamStatus.isFulfilled || streamStatus.isErrored
    ? streamStatus
    : EMPTY_TOPIC_STREAM_STATE
}

const useTopicListStreamStatus = (topicId: string): TopicStreamState =>
  useSharedCacheSelector(
    [getTopicStreamStatusCacheKey(topicId), getTopicStreamLastSeenCompletionCacheKey(topicId)],
    selectTopicStreamState
  )

interface TopicListBodyProps {
  activeTopic?: Topic
  assistantMoveTargets: readonly TopicMoveAssistantTarget[]
  displayMode: TopicDisplayMode
  exportMenuOptions: TopicExportMenuOptions
  listRef: RefObject<HTMLDivElement | null>
  notesPath: string
  onAutoRename: (topic: Topic) => Promise<void>
  onClearMessages: (topic: Topic) => void
  onDeleteFromMenu: (topic: Topic) => Promise<void>
  onDeletePermanently: (topic: Topic) => Promise<void>
  deleteShortcut: string
  permanentDeleteShortcut: string
  onMoveToAssistant: (topic: Topic, assistantId: string) => void | Promise<void>
  onOpenInNewTab?: (topic: Topic) => void
  onOpenInNewWindow?: (topic: Topic) => void
  onPinTopic: (topic: Topic) => Promise<void>
  onToggleSidebar: (topic: Topic) => void
  onRequestTopicImageAction: (type: TopicImageActionType, topic: Topic) => void
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onSwitchTopic: (topic: Topic) => void
  panePosition?: TopicTabPosition
  sidebarTopicFavoriteIdSet: ReadonlySet<string>
  topicsLength: number
  variant: TopicListBodyVariant
}

type TopicRowSharedProps = Omit<TopicListBodyProps, 'activeTopic' | 'listRef' | 'variant'>

export function TopicListBody(props: TopicListBodyProps) {
  const { t } = useTranslation()
  const {
    activeTopic,
    assistantMoveTargets,
    displayMode,
    exportMenuOptions,
    listRef,
    notesPath,
    onAutoRename,
    onClearMessages,
    onDeleteFromMenu,
    onDeletePermanently,
    deleteShortcut,
    permanentDeleteShortcut,
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onToggleSidebar,
    onRequestTopicImageAction,
    onSetPanePosition,
    onSwitchTopic,
    panePosition,
    sidebarTopicFavoriteIdSet,
    topicsLength,
    variant
  } = props

  const rowProps = useMemo<TopicRowSharedProps>(
    () => ({
      assistantMoveTargets,
      displayMode,
      exportMenuOptions,
      notesPath,
      onAutoRename,
      onClearMessages,
      onDeleteFromMenu,
      onDeletePermanently,
      deleteShortcut,
      permanentDeleteShortcut,
      onMoveToAssistant,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onToggleSidebar,
      onRequestTopicImageAction,
      onSetPanePosition,
      onSwitchTopic,
      panePosition,
      sidebarTopicFavoriteIdSet,
      topicsLength
    }),
    [
      assistantMoveTargets,
      displayMode,
      exportMenuOptions,
      notesPath,
      onAutoRename,
      onClearMessages,
      onDeleteFromMenu,
      onDeletePermanently,
      deleteShortcut,
      permanentDeleteShortcut,
      onMoveToAssistant,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onToggleSidebar,
      onRequestTopicImageAction,
      onSetPanePosition,
      onSwitchTopic,
      panePosition,
      sidebarTopicFavoriteIdSet,
      topicsLength
    ]
  )

  const shortcutHints = useConversationListShortcuts(onSwitchTopic)
  const activeTopicId = activeTopic?.id
  const renderItem = useCallback(
    (topic: Topic) => (
      <TopicRow
        key={topic.id}
        shortcutHint={shortcutHints.get(topic.id)}
        topic={topic}
        isActive={topic.id === activeTopicId}
        {...rowProps}
      />
    ),
    [activeTopicId, rowProps, shortcutHints]
  )

  return (
    <ResourceList.Body<Topic>
      listRef={listRef}
      draggable={variant === 'draggable'}
      errorFallback={<ResourceList.ErrorState message={t('error.boundary.default.message')} />}
      emptyFallback={
        <div className="text-muted-foreground mx-auto flex h-full w-full max-w-sm items-center justify-center px-5 py-10 text-center text-xs break-words">
          {t('chat.topics.empty.title')}
        </div>
      }
      renderItem={renderItem}
    />
  )
}

interface TopicRowWithStatusProps extends TopicRowSharedProps {
  shortcutHint?: string
  isActive: boolean
  topic: Topic
}

type TopicRowProps = TopicRowWithStatusProps

const TopicRow = memo(function TopicRow({
  assistantMoveTargets,
  displayMode,
  exportMenuOptions,
  isActive,
  notesPath,
  onAutoRename,
  onClearMessages,
  onDeleteFromMenu,
  onDeletePermanently,
  deleteShortcut,
  permanentDeleteShortcut,
  onMoveToAssistant,
  onOpenInNewTab,
  onOpenInNewWindow,
  onPinTopic,
  onToggleSidebar,
  onRequestTopicImageAction,
  onSetPanePosition,
  onSwitchTopic,
  panePosition,
  sidebarTopicFavoriteIdSet,
  topic,
  shortcutHint,
  topicsLength
}: TopicRowProps) {
  const { t } = useTranslation()
  const { isRenaming, isNewlyRenamed } = useTopicRenameState(topic.id)
  const rightPanelState = useOptionalRightPanelState()
  const rightPanelActions = useOptionalRightPanelActions()
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(topic.id)
  const streamStatus = useTopicListStreamStatus(topic.id)
  const topicDisplayName = topic.name.trim() ? topic.name : t('chat.conversation.new')
  const topicName = topicDisplayName.replace('`', '')
  // The row truncates its title, so the hover card carries the full name plus when the
  // conversation was last active.
  const hoverCard = (
    <div className="flex max-w-72 flex-col gap-0.5 text-left">
      <span className="font-medium">{topicName}</span>
      <span className="text-muted-foreground">
        {t('chat.topics.hover.last_activity', { time: dayjs(topic.lastActivityAt).format('YYYY-MM-DD HH:mm') })}
      </span>
    </div>
  )
  const nameAnimationClassName = isRenaming ? 'animation-shimmer' : isNewlyRenamed ? 'animation-reveal' : ''
  const {
    isAwaitingApproval: isTopicAwaitingApproval,
    isErrored: isTopicStreamErrored,
    isFulfilled: isTopicStreamFulfilled,
    isPending: isTopicStreamPending
  } = streamStatus
  // Running (spinner) and errored (red) are ongoing states that stay on the
  // selected row too — only the completion dot (green) is a read-receipt that
  // clears once the row is opened (`!isActive`). Awaiting approval is shown as
  // a badge instead of a spinner because the turn needs user action.
  const conversationRowStatus = isTopicAwaitingApproval
    ? 'approval'
    : isTopicStreamPending
      ? 'pending'
      : isTopicStreamErrored
        ? 'error'
        : !isActive && isTopicStreamFulfilled
          ? 'done'
          : null
  const hasTopicStreamIndicator = conversationRowStatus !== null && conversationRowStatus !== 'approval'
  const showPinAction = !rowState.renaming
  const showLeadingSlot = displayMode !== 'time'
  const canDeleteTopic = !topic.pinned
  const isArchiveBlocked = isTopicStreamPending || isTopicAwaitingApproval
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startInlineRename = useCallback(() => actions.startRename(topic.id), [actions, topic.id])
  const startMenuRename = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback((name: string) => actions.commitRename(topic.id, name), [actions, topic.id])
  const { getMenuActions, handleMenuAction } = useTopicMenuActions({
    exportMenuOptions,
    isArchiveBlocked,
    isActiveInCurrentTab: isActive,
    isRenaming,
    notesPath,
    assistantMoveTargets,
    onAutoRename,
    onClearMessages,
    onCopyImage: (topic) => onRequestTopicImageAction('copy', topic),
    onDelete: onDeleteFromMenu,
    onDeletePermanently,
    deleteShortcut,
    permanentDeleteShortcut,
    onExportImage: (topic) => onRequestTopicImageAction('export', topic),
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onToggleSidebar,
    onSetPanePosition,
    onStartRename: startMenuRename,
    panePosition,
    sidebarPinned: sidebarTopicFavoriteIdSet.has(topic.id),
    t,
    topic,
    topicsLength
  })
  const deleteAction = useMemo(() => getMenuActions().find((action) => action.id === 'topic.delete'), [getMenuActions])

  const row = (
    <ResourceList.Item
      item={topic}
      data-testid="topic-list-row"
      className="relative"
      style={{ cursor: 'pointer' }}
      onClick={() => {
        if (rightPanelState?.maximized) rightPanelActions?.minimize()
        onSwitchTopic(topic)
      }}>
      {showLeadingSlot && <ResourceList.ItemLeadingSlot className="relative" />}
      <ResourceList.RenameField
        item={topic}
        aria-label={t('chat.topics.edit.title')}
        autoFocus
        onClick={(event) => event.stopPropagation()}
      />
      {!rowState.renaming && (
        <SessionHoverPreview id={topic.id} content={hoverCard}>
          <ResourceList.ItemTitle
            fade
            className={cn(
              nameAnimationClassName,
              // The stream indicator is an absolute overlay (keeps no flex space),
              // so the title needs a standing yield for its dot zone; on hover the
              // overlay fades out, the standing yield closes, and the in-flow action rail expands.
              // The draft indicator needs no yield — it stays in flow and reserves its own space.
              hasTopicStreamIndicator && CONVERSATION_ROW_STATUS_TITLE_CLASS
            )}
            onDoubleClick={(event) => {
              event.stopPropagation()
              startInlineRename()
            }}>
            {topicName}
          </ResourceList.ItemTitle>
        </SessionHoverPreview>
      )}
      {!rowState.renaming && (
        <TopicTrailingStatus
          topicId={topic.id}
          draftLabel={t('chat.topics.draft')}
          isActive={isActive}
          status={conversationRowStatus}
        />
      )}
      {!rowState.renaming && shortcutHint && (
        <Kbd className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{shortcutHint}</Kbd>
      )}
      <ResourceList.ItemActions pinned={topic.pinned && showPinAction}>
        {showPinAction && (
          <Tooltip title={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')} delay={500}>
            <ResourceList.ItemAction
              aria-label={topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')}
              aria-pressed={topic.pinned}
              className={cn(topic.pinned && 'text-foreground')}
              onClick={(event) => {
                event.stopPropagation()
                void onPinTopic(topic)
              }}>
              <PinIcon size={14} className={cn('size-3.5!', topic.pinned && 'fill-current')} />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
        {canDeleteTopic && (
          <Tooltip
            title={isArchiveBlocked ? t('recycle_bin.move.blocked_generation') : t('common.archive')}
            delay={500}>
            <ResourceList.ItemAction
              aria-label={t('common.archive')}
              disabled={isArchiveBlocked}
              onClick={(event) => {
                event.stopPropagation()
                if (deleteAction) void handleMenuAction(deleteAction)
              }}>
              <Archive size={14} className="size-3.5!" />
            </ResourceList.ItemAction>
          </Tooltip>
        )}
      </ResourceList.ItemActions>
    </ResourceList.Item>
  )

  return (
    <>
      <ResourceListActionContextMenu item={topic} getActions={getMenuActions} onAction={handleMenuAction}>
        {row}
      </ResourceListActionContextMenu>
      <EditNameDialog
        open={renameDialogOpen}
        title={t('chat.topics.edit.title')}
        initialName={topic.name}
        placeholder={t('chat.topics.edit.placeholder')}
        onSubmit={submitRenameDialog}
        onOpenChange={setRenameDialogOpen}
      />
    </>
  )
})

const TOPIC_DRAFT_INDICATOR_CLASS =
  'pointer-events-none flex size-5 max-w-5 shrink-0 items-center justify-center overflow-hidden opacity-100 transition-[margin,max-width,opacity] duration-150 group-hover:-ml-1.5 group-hover:max-w-0 group-hover:opacity-0 group-has-[[data-resource-list-item-actions]:focus-within]:-ml-1.5 group-has-[[data-resource-list-item-actions][data-active=true]]:-ml-1.5 group-has-[[data-resource-list-item-actions]:focus-within]:max-w-0 group-has-[[data-resource-list-item-actions][data-active=true]]:max-w-0 group-has-[[data-resource-list-item-actions]:focus-within]:opacity-0 group-has-[[data-resource-list-item-actions][data-active=true]]:opacity-0'

const TopicTrailingStatus = ({
  topicId,
  draftLabel,
  isActive,
  status
}: {
  topicId: string
  draftLabel: string
  isActive: boolean
  status: ConversationRowStatusValue | null
}) => {
  if (status) {
    return (
      <ConversationRowStatus
        status={status}
        testId={status === 'approval' ? 'topic-awaiting-approval-badge' : 'topic-stream-indicator'}
      />
    )
  }

  // The active row's draft is the text visible in the composer right below it,
  // so flagging it as unsent tells the user nothing.
  if (isActive) return null

  // The draft subscriber mounts only in the lowest-priority branch. Virtualized
  // rows that are offscreen, or rows showing a higher-priority status, subscribe
  // to no draft key at all.
  return <TopicDraftIndicator topicId={topicId} label={draftLabel} />
}

const TopicDraftIndicator = ({ topicId, label }: { topicId: string; label: string }) => {
  const subscribe = useCallback((listener: () => void) => subscribeChatDraftCache(topicId, listener), [topicId])
  const getSnapshot = useCallback(() => readChatDraftPresence(topicId), [topicId])
  const hasDraft = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (!hasDraft) return null

  return (
    <span aria-label={label} className={TOPIC_DRAFT_INDICATOR_CLASS} role="img">
      <FilePenLine aria-hidden="true" className="text-foreground-tertiary size-3" />
    </span>
  )
}
