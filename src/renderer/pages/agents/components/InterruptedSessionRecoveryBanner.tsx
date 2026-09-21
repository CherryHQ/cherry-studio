/**
 * Recovery notice for agent sessions whose work was interrupted by the
 * previous app exit (crash or graceful quit mid-turn).
 *
 * The record is written main-side (ids only) at boot reconcile for crashes and
 * at runtime `onStop` for graceful quits; this component joins nothing — it
 * renders whatever `GET /agent-sessions/interrupted-recovery` still considers
 * interrupted (deleted or already-resumed sessions are filtered out
 * server-side). It renders nothing until that response arrives, so the agent
 * page layout is unaffected in the common case, and it stays up — across
 * session switches and page navigation — until every item is resumed or the
 * notice is dismissed.
 *
 * Two actions per selection: `Open` navigates to the interrupted turn, and
 * `Continue` delivers a resume message to each selected session through the
 * durable delivery pipeline (busy-guarded, headless). Graceful-quit sessions
 * keep their resume token, so the CLI holds the full task context and the
 * resume prompt only redirects; crashed sessions lost theirs (#18289), so
 * their prompt is self-contained and anchored on the last user message. A
 * resumed session gains a message newer than the interruption, so it drops
 * out of the notice on the next read.
 */

import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Play, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { cn } from '@renderer/utils/style'

export const InterruptedSessionRecoveryBanner = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, refetch, mutate } = useQuery('/agent-sessions/interrupted-recovery')
  const { trigger: dismiss } = useMutation('DELETE', '/agent-sessions/interrupted-recovery', {
    onSuccess: () => void mutate(undefined, { revalidate: false })
  })
  const { trigger: resume, isLoading: isResuming } = useMutation(
    'POST',
    '/agent-sessions/interrupted-recovery/resume',
    { onSuccess: () => void refetch() }
  )

  const recovery = data ?? null
  const items = recovery?.items ?? []
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())

  const handleOpen = useCallback(
    (sessionId: string, agentId: string | null) => {
      void navigate({
        to: '/app/agents',
        search: { sessionId, ...(agentId ? { agentId } : {}) }
      })
    },
    [navigate]
  )

  const toggleChecked = useCallback((sessionId: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])

  const handleContinue = useCallback(() => {
    if (checkedIds.size === 0) return
    void resume({ body: { sessionIds: [...checkedIds] } })
    setCheckedIds(new Set())
  }, [checkedIds, resume])

  if (isLoading || !recovery || items.length === 0) return null

  const title =
    recovery.kind === 'crash'
      ? t('agent.recovery.noticeTitle.crash', { count: items.length })
      : t('agent.recovery.noticeTitle.gracefulExit', { count: items.length })

  return (
    <div
      className="mx-2 mt-2 flex flex-col gap-1 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2"
      data-testid="interrupted-session-recovery-banner">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <AlertTriangle size={14} className="shrink-0 text-warning" />
        <span className="flex-1">{title}</span>
        <button
          type="button"
          className="flex cursor-pointer items-center rounded p-1 text-muted hover:bg-accent"
          aria-label={t('agent.recovery.dismiss')}
          onClick={() => void dismiss()}>
          <X size={14} />
        </button>
      </div>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.sessionId} className="flex min-w-0 items-center gap-2 py-1 text-[13px]">
            <input
              type="checkbox"
              className="size-3.5 shrink-0 cursor-pointer accent-current"
              aria-label={t('agent.recovery.selectItem', {
                name: item.sessionName || item.agentName || t('agent.recovery.untitledSession')
              })}
              checked={checkedIds.has(item.sessionId)}
              onChange={(event) => toggleChecked(item.sessionId, event.target.checked)}
            />
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded px-1 py-0.5 text-left',
                'hover:bg-accent'
              )}
              onClick={() => handleOpen(item.sessionId, item.agentId)}>
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {item.sessionName || item.agentName || t('agent.recovery.untitledSession')}
                </span>
                {item.agentName && item.sessionName ? (
                  <span className="truncate text-[12px] text-muted">{item.agentName}</span>
                ) : null}
                {item.sessionType === 'background' ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[11px] text-muted">
                    {t('agent.recovery.backgroundBadge')}
                  </span>
                ) : null}
              </span>
              <span className="flex w-full min-w-0 items-center gap-1 text-[12px] text-muted">
                <span className="truncate">{item.summary ?? t('agent.recovery.summaryFallback')}</span>
                {item.workspacePath ? (
                  <span className="truncate font-mono text-[11px]" title={item.workspacePath}>
                    {item.workspacePath}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px] text-muted hover:bg-accent"
              onClick={() => handleOpen(item.sessionId, item.agentId)}>
              {t('agent.recovery.open')}
              <ArrowRight size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={checkedIds.size === 0 || isResuming}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md bg-warning-border px-2.5 py-1 text-[12px] font-medium text-warning-subtle-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          title={t('agent.recovery.continueHint')}
          onClick={handleContinue}>
          <Play size={12} />
          {t('agent.recovery.continue', { count: checkedIds.size })}
        </button>
        <span className="text-[11px] text-muted">{t('agent.recovery.continueHint')}</span>
      </div>
    </div>
  )
}
