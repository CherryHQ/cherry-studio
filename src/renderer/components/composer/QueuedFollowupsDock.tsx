import { Button, ReorderableList, Tooltip } from '@cherrystudio/ui'
import { type ChatInputTokenKind, type ChatTokenView } from '@renderer/components/composer/chatTokenView'
import { ComposerToken } from '@renderer/components/composer/tokenView'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import { cn } from '@renderer/utils/style'
import { AlertTriangle, ArrowUp, GripVertical, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { excludeComposerDraftTokens } from './composerDraft'
import type { FollowupQueueItem } from './useFollowupQueue'

/** Max rows shown before the dock collapses behind an "Expand N more…" toggle. */
export const QUEUE_VISIBLE_LIMIT = 3

interface QueuedFollowupsDockProps {
  items: FollowupQueueItem[]
  paused: boolean
  onTogglePause: () => void
  onSteer: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (nextItems: FollowupQueueItem[]) => void
  /** Drop every pending message at once. */
  onClearAll: () => void
  /** Head item whose auto-send failed (queue auto-paused) — shows the Skip/Retry/Abort banner. */
  failedItemId?: string | null
  onRetryFailed?: () => void
  onSkipFailed?: () => void
  onAbortQueue?: () => void
  isSteerDisabled?: (item: FollowupQueueItem) => boolean
  steerDisabledReason?: string
}

/** Read-only chips for a queued draft's composer tokens (file / skill / knowledge / quote …). */
function DraftTokenChips({ item, hasText }: { item: FollowupQueueItem; hasText: boolean }) {
  const tokens = (item.draft?.tokens ?? []).filter((token) => isComposerInputTokenKind(token.kind))
  if (tokens.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1', hasText && 'mt-1')}>
      {tokens.map((token) => (
        <ComposerToken
          key={token.id}
          token={
            {
              id: token.id,
              kind: token.kind as ChatInputTokenKind,
              label: token.label,
              description: token.description,
              promptText: token.promptText,
              payload: token.payload
            } satisfies ChatTokenView
          }
        />
      ))}
    </div>
  )
}

function getFollowupPreviewText(item: FollowupQueueItem): string {
  return item.draft
    ? excludeComposerDraftTokens(item.draft, (token) => isComposerInputTokenKind(token.kind)).text.trim()
    : item.payload.text
}

function QueuedFollowupRow({
  item,
  dragging,
  onSteer,
  onEdit,
  onRemove,
  isSteerDisabled,
  steerDisabledReason
}: {
  item: FollowupQueueItem
  dragging: boolean
  onSteer: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  isSteerDisabled?: (item: FollowupQueueItem) => boolean
  steerDisabledReason?: string
}) {
  const { t } = useTranslation()
  const previewText = getFollowupPreviewText(item)
  const steerDisabled = isSteerDisabled?.(item) ?? false

  return (
    <div className="group flex items-center gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5">
      <span
        aria-hidden
        data-dragging={dragging ? 'true' : 'false'}
        className="flex shrink-0 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 data-[dragging=true]:opacity-100">
        <GripVertical className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {previewText ? <span className="line-clamp-2 text-foreground text-sm">{previewText}</span> : null}
        <DraftTokenChips item={item} hasText={Boolean(previewText)} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip
          placement="top"
          content={
            steerDisabled
              ? (steerDisabledReason ?? t('chat.input.followup_queue.steer'))
              : t('chat.input.followup_queue.steer')
          }>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shadow-none"
            aria-label={t('chat.input.followup_queue.steer')}
            disabled={steerDisabled}
            onClick={() => onSteer(item.id)}>
            <ArrowUp className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip placement="top" content={t('chat.input.followup_queue.edit')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shadow-none"
            aria-label={t('chat.input.followup_queue.edit')}
            onClick={() => onEdit(item.id)}>
            <Pencil className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip placement="top" content={t('chat.input.followup_queue.remove')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shadow-none"
            aria-label={t('chat.input.followup_queue.remove')}
            onClick={() => onRemove(item.id)}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Dock above the input listing queued follow-up drafts (queue mode). Items are drag-reorderable;
 * each can be steered into the running turn, edited back into the composer, or removed; auto-drain
 * can be paused or the whole queue cleared. A failed auto-send surfaces a Skip/Retry/Abort banner.
 * Beyond `QUEUE_VISIBLE_LIMIT` rows the list collapses behind an "Expand N more…" toggle. Renders
 * via `ComposerSurface.queueContent`.
 */
export function QueuedFollowupsDock({
  items,
  paused,
  onTogglePause,
  onSteer,
  onEdit,
  onRemove,
  onReorder,
  onClearAll,
  failedItemId,
  onRetryFailed,
  onSkipFailed,
  onAbortQueue,
  isSteerDisabled,
  steerDisabledReason
}: QueuedFollowupsDockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const failed = failedItemId != null ? items.find((item) => item.id === failedItemId) : undefined
  const visibleItems = expanded || items.length <= QUEUE_VISIBLE_LIMIT ? items : items.slice(0, QUEUE_VISIBLE_LIMIT)
  const hiddenCount = items.length - visibleItems.length

  return (
    <div
      className="mx-2 mb-1.5 rounded-[16px] border-[0.5px] border-border p-1.5 backdrop-blur"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-muted-foreground text-xs">
          {t('chat.input.followup_queue.title', { count: items.length })}
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip placement="top" content={t('chat.input.followup_queue.clear_all')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shadow-none"
              aria-label={t('chat.input.followup_queue.clear_all')}
              onClick={onClearAll}>
              <Trash2 className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip
            placement="top"
            content={paused ? t('chat.input.followup_queue.resume') : t('chat.input.followup_queue.pause')}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shadow-none"
              aria-label={paused ? t('chat.input.followup_queue.resume') : t('chat.input.followup_queue.pause')}
              onClick={onTogglePause}>
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </Button>
          </Tooltip>
        </div>
      </div>
      {failed ? (
        <div className="mb-1.5 flex items-center gap-1.5 rounded-[12px] border-[0.5px] border-destructive/30 bg-destructive/10 px-2 py-1.5">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive text-xs">{t('chat.input.followup_queue.failure_title')}</p>
            <p className="line-clamp-1 text-muted-foreground text-xs">{getFollowupPreviewText(failed)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={onSkipFailed}>
              {t('chat.input.followup_queue.skip')}
            </Button>
            <Button type="button" size="sm" onClick={onRetryFailed}>
              {t('chat.input.followup_queue.retry')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onAbortQueue}>
              {t('chat.input.followup_queue.abort')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="max-h-40 overflow-y-auto">
        <ReorderableList
          items={items}
          visibleItems={visibleItems}
          getId={(item) => item.id}
          onReorder={onReorder}
          direction="vertical"
          gap={4}
          renderItem={(item, _index, { dragging }) => (
            <QueuedFollowupRow
              item={item}
              dragging={dragging}
              onSteer={onSteer}
              onEdit={onEdit}
              onRemove={onRemove}
              isSteerDisabled={isSteerDisabled}
              steerDisabledReason={steerDisabledReason}
            />
          )}
        />
      </div>
      {items.length > QUEUE_VISIBLE_LIMIT ? (
        <div className="mt-1 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-muted-foreground"
            onClick={() => setExpanded((value) => !value)}>
            {expanded
              ? t('chat.input.followup_queue.collapse')
              : t('chat.input.followup_queue.expand_more', { count: hiddenCount })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
