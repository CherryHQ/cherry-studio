import { Check, CircleAlert, Hourglass, LoaderCircle, MessageCircleQuestionMark, X } from 'lucide-react'
import type { FC } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSharedCacheValue } from '@data/hooks/useCache'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import type { SelectionAgentCapsule } from '@shared/types/selection'

/** Beyond this many capsules, the rest fold into "+N", which expands them and folds them back. */
const MAX_VISIBLE = 5

/** One display's stack of collapsed agent windows; main sizes the window to whatever this measures. */
const SelectionCapsuleStack: FC = () => {
  const init = useWindowInitData<{ displayId: number }>()
  if (!init) return null
  return <CapsuleStack displayId={init.displayId} />
}

const CapsuleStack: FC<{ displayId: number }> = ({ displayId }) => {
  const { t } = useTranslation()
  const capsules = useSharedCacheValue(`selection.agent_capsules.${displayId}` as const) ?? []
  const [expanded, setExpanded] = useState(false)
  const stackRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const stack = stackRef.current
    if (!stack) return
    const observer = new ResizeObserver(() => {
      void ipcApi.request('selection.determine_capsule_size', { width: stack.offsetWidth, height: stack.offsetHeight })
    })
    observer.observe(stack)
    return () => observer.disconnect()
  }, [])

  const visible = expanded ? capsules : capsules.slice(0, MAX_VISIBLE)
  const foldable = capsules.length > MAX_VISIBLE

  return (
    // Main caps the host at the work area; a taller stack scrolls, starting from the corner end.
    <div className="flex max-h-screen flex-col-reverse overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Column-reverse puts the first capsule nearest the corner; the padding leaves room for the shadows. */}
      <div ref={stackRef} className="flex shrink-0 flex-col-reverse items-end gap-2 p-2">
        {visible.map((capsule) => (
          <Capsule key={capsule.windowId} capsule={capsule} />
        ))}
        {/* Sticky, so Show less stays reachable while a tall stack is scrolled to the corner. */}
        {foldable && (
          <button
            type="button"
            className="sticky top-2 h-9 rounded-full border border-border bg-popover px-3 text-muted-foreground text-xs shadow-md"
            onClick={() => setExpanded(!expanded)}>
            {expanded
              ? t('selection.agent.capsule.show_less')
              : t('selection.agent.capsule.more', { count: capsules.length - MAX_VISIBLE })}
          </button>
        )}
      </div>
    </div>
  )
}

const STATUS_VIEW = {
  starting: { icon: LoaderCircle, tone: 'text-muted-foreground', labelKey: 'selection.agent.capsule.running' },
  running: { icon: LoaderCircle, tone: 'text-muted-foreground', labelKey: 'selection.agent.capsule.running' },
  'awaiting-approval': {
    icon: Hourglass,
    tone: 'text-warning-subtle-foreground',
    labelKey: 'selection.agent.capsule.needs_approval'
  },
  'needs-input': {
    icon: MessageCircleQuestionMark,
    tone: 'text-warning-subtle-foreground',
    labelKey: 'selection.agent.capsule.needs_input'
  },
  done: { icon: Check, tone: 'text-success', labelKey: 'selection.agent.capsule.done' },
  failed: { icon: CircleAlert, tone: 'text-error', labelKey: 'selection.agent.capsule.failed' }
} as const

/** Agent and status; hovering reveals the session title and a close button. A click restores the window. */
const Capsule: FC<{ capsule: SelectionAgentCapsule }> = ({ capsule }) => {
  const { t } = useTranslation()
  const view = STATUS_VIEW[capsule.status]
  const Icon = view.icon
  const isActive = capsule.status === 'starting' || capsule.status === 'running'
  const waitsOnUser = capsule.status === 'awaiting-approval' || capsule.status === 'needs-input'

  return (
    <div
      className={cn(
        'group flex h-9 items-center gap-1 rounded-full border bg-popover pr-3 text-foreground text-xs shadow-md hover:pr-1.5',
        waitsOnUser ? 'border-warning-border bg-warning-subtle' : 'border-border'
      )}>
      <button
        type="button"
        className="flex h-full min-w-0 items-center gap-2 rounded-full pl-[7px]"
        onClick={() => void ipcApi.request('selection.restore_agent_window', capsule.windowId)}>
        <span
          aria-hidden="true"
          className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-muted text-[11px] leading-none">
          {capsule.agentAvatar}
        </span>
        <span className="font-medium">{capsule.agentName}</span>
        {capsule.sessionTitle && (
          <span className="hidden max-w-45 truncate text-muted-foreground group-hover:inline">
            {capsule.sessionTitle}
          </span>
        )}
        <span className={cn('inline-flex items-center gap-1 whitespace-nowrap tabular-nums', view.tone)}>
          <Icon className={cn('size-3', isActive && 'animate-spin motion-reduce:animate-none')} />
          {isActive && capsule.steps > 0 ? t('selection.agent.capsule.step', { n: capsule.steps }) : t(view.labelKey)}
        </span>
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        className="hidden size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent group-hover:inline-flex"
        onClick={() => void ipcApi.request('selection.close_agent_window', capsule.windowId)}>
        <X className="size-3" />
      </button>
    </div>
  )
}

export default SelectionCapsuleStack
