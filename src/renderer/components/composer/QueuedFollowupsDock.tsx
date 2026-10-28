import { ArrowUp, ChevronRight, GripVertical, Pause, Pencil, Play, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ReorderableList, Tooltip } from '@cherrystudio/ui'
import { type ChatInputTokenKind, type ChatTokenView } from '@renderer/components/composer/chatTokenView'
import { ComposerToken } from '@renderer/components/composer/tokenView'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'
import { cn } from '@renderer/utils/style'

import { excludeComposerDraftTokens } from './composerDraft'
import type { FollowupQueueItem } from './useFollowupQueue'

const QUEUE_EASE = [0.23, 1, 0.32, 1] as const
const QUEUE_CSS_EASE = `cubic-bezier(${QUEUE_EASE.join(',')})`

interface QueuedFollowupsDockProps {
  items: FollowupQueueItem[]
  paused: boolean
  onTogglePause: () => void
  onSteer: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (nextItems: FollowupQueueItem[]) => void
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
  const previewText = item.draft
    ? excludeComposerDraftTokens(item.draft, (token) => isComposerInputTokenKind(token.kind)).text.trim()
    : item.payload.text
  const steerDisabled = isSteerDisabled?.(item) ?? false

  return (
    <div className="group flex items-center gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5">
      <span
        aria-hidden
        data-dragging={dragging ? 'true' : 'false'}
        className="text-muted-foreground flex shrink-0 cursor-grab items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 data-[dragging=true]:opacity-100">
        <GripVertical className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {previewText ? <span className="line-clamp-2 text-sm text-foreground">{previewText}</span> : null}
        <DraftTokenChips item={item} hasText={Boolean(previewText)} />
      </div>
      <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
 * can be paused. Renders via `ComposerSurface.queueContent`.
 */
export function QueuedFollowupsDock({
  items,
  paused,
  onTogglePause,
  onSteer,
  onEdit,
  onRemove,
  onReorder,
  isSteerDisabled,
  steerDisabledReason
}: QueuedFollowupsDockProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [shouldAnimate, setShouldAnimate] = useState(false)
  const listId = useId()
  const transition = {
    type: 'tween' as const,
    duration: shouldAnimate ? 0.2 : 0,
    ease: QUEUE_EASE
  }
  if (items.length === 0) return null

  return (
    <motion.div
      layout
      layoutDependency={isExpanded}
      transition={transition}
      className="relative mx-2 mb-1.5 border-[0.5px] border-border p-1.5 backdrop-blur"
      style={{
        borderRadius: 16,
        originY: 1,
        backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)'
      }}>
      <motion.div
        layout="position"
        layoutDependency={isExpanded}
        transition={transition}
        className={cn('flex items-center justify-between px-1.5', isExpanded && 'pb-1')}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-6 min-h-0 flex-1 justify-start gap-1 px-0 text-xs font-normal shadow-none transition-colors hover:bg-transparent"
          aria-expanded={isExpanded}
          aria-controls={listId}
          onClick={(event) => {
            setShouldAnimate(event.detail > 0 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
            setIsExpanded((value) => !value)
          }}>
          {t('chat.input.followup_queue.title', { count: items.length })}
          <span
            aria-hidden
            className="inline-flex"
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transitionProperty: 'transform',
              transitionDuration: `${transition.duration}s`,
              transitionTimingFunction: QUEUE_CSS_EASE
            }}>
            <ChevronRight className="size-3.5" />
          </span>
        </Button>
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
      </motion.div>
      <motion.div
        id={listId}
        aria-hidden={!isExpanded}
        inert={!isExpanded}
        layout="position"
        layoutDependency={isExpanded}
        transition={transition}
        className="relative"
        style={{ height: isExpanded ? 'auto' : 0 }}>
        <motion.div layout="position" layoutDependency={isExpanded} transition={transition}>
          <div
            className="max-h-40 overflow-y-auto transition-[opacity,transform]"
            style={{
              opacity: isExpanded ? 1 : 0,
              transform: isExpanded ? 'translateY(0px)' : 'translateY(4px)',
              transitionDuration: `${transition.duration}s`,
              transitionTimingFunction: QUEUE_CSS_EASE
            }}>
            <ReorderableList
              items={items}
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
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
