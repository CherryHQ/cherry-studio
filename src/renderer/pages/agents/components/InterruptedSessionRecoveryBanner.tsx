/**
 * One-shot recovery notice for agent sessions whose work was interrupted by
 * the previous app exit (crash or graceful quit mid-turn).
 *
 * The record is written main-side (ids only) at boot reconcile for crashes and
 * at runtime `onStop` for graceful quits; this component joins nothing — it
 * renders whatever `GET /agent-sessions/interrupted-recovery` still considers
 * interrupted (deleted or already-resumed sessions are filtered out
 * server-side). It renders nothing until that response arrives, so the agent
 * page layout is unaffected in the common case.
 *
 * Actions are deliberately navigational only: opening a session shows the full
 * interrupted turn (terminalized tools, subagent tasks, partial output), and
 * the user decides how to continue. Graceful-quit sessions keep their resume
 * token, so any follow-up message continues with full CLI context — auto-sent
 * "continue" messages are intentionally out of scope here.
 */

import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { cn } from '@renderer/utils/style'

export const InterruptedSessionRecoveryBanner = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, mutate } = useQuery('/agent-sessions/interrupted-recovery')
  const { trigger: dismiss } = useMutation('DELETE', '/agent-sessions/interrupted-recovery', {
    onSuccess: () => void mutate(undefined, { revalidate: false })
  })

  const recovery = data ?? null

  const handleOpen = useCallback(
    (sessionId: string, agentId: string | null) => {
      void navigate({
        to: '/app/agents',
        search: { sessionId, ...(agentId ? { agentId } : {}) }
      })
    },
    [navigate]
  )

  if (isLoading || !recovery || recovery.items.length === 0) return null

  const title =
    recovery.kind === 'crash'
      ? t('agent.recovery.noticeTitle.crash', { count: recovery.items.length })
      : t('agent.recovery.noticeTitle.gracefulExit', { count: recovery.items.length })

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
        {recovery.items.map((item) => (
          <li key={item.sessionId} className="flex min-w-0 items-center gap-2 py-1 text-[13px]">
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
    </div>
  )
}
