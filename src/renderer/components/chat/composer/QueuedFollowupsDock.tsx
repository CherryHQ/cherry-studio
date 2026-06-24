import { Button, ReorderableList } from '@cherrystudio/ui'
import { ComposerToken } from '@renderer/components/chat/tokens/ComposerToken'
import {
  CHAT_INPUT_TOKEN_KINDS,
  type ChatInputTokenKind,
  type ChatTokenView
} from '@renderer/components/chat/tokens/tokenView'
import { Pause, Pencil, Play, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FollowupQueueItem } from './useFollowupQueue'

interface QueuedFollowupsDockProps {
  items: FollowupQueueItem[]
  paused: boolean
  onTogglePause: () => void
  onSteer: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (nextItems: FollowupQueueItem[]) => void
}

const DISPLAY_TOKEN_KINDS = new Set<string>(CHAT_INPUT_TOKEN_KINDS)

/** Read-only chips for a queued draft's composer tokens (file / skill / knowledge / quote …). */
function DraftTokenChips({ item }: { item: FollowupQueueItem }) {
  const tokens = (item.draft?.tokens ?? []).filter((token) => DISPLAY_TOKEN_KINDS.has(token.kind))
  if (tokens.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
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
  onSteer,
  onEdit,
  onRemove
}: {
  item: FollowupQueueItem
  onSteer: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="group flex items-start gap-1.5 rounded-[12px] bg-muted/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <span className="line-clamp-2 text-foreground text-sm">{item.draft?.text ?? item.payload.text}</span>
        <DraftTokenChips item={item} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shadow-none"
          aria-label={t('chat.input.followup_queue.steer')}
          onClick={() => onSteer(item.id)}>
          <Zap className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shadow-none"
          aria-label={t('chat.input.followup_queue.edit')}
          onClick={() => onEdit(item.id)}>
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shadow-none"
          aria-label={t('chat.input.followup_queue.remove')}
          onClick={() => onRemove(item.id)}>
          <X className="size-4" />
        </Button>
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
  onReorder
}: QueuedFollowupsDockProps) {
  const { t } = useTranslation()
  if (items.length === 0) return null

  return (
    <div className="mx-2 mb-1.5 rounded-[16px] border-[0.5px] border-border bg-(--color-background-opacity) p-1.5 backdrop-blur">
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-muted-foreground text-xs">
          {t('chat.input.followup_queue.title', { count: items.length })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 shadow-none"
          aria-label={paused ? t('chat.input.followup_queue.resume') : t('chat.input.followup_queue.pause')}
          onClick={onTogglePause}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </Button>
      </div>
      <div className="max-h-40 overflow-y-auto">
        <ReorderableList
          items={items}
          getId={(item) => item.id}
          onReorder={onReorder}
          direction="vertical"
          gap={4}
          renderItem={(item) => <QueuedFollowupRow item={item} onSteer={onSteer} onEdit={onEdit} onRemove={onRemove} />}
        />
      </div>
    </div>
  )
}
