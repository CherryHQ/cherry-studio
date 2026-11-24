import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import { useDataChange } from '@renderer/data/hooks/useDataChange'
import {
  AgentPlanEntitySchema,
  AgentPlanHistoryEntitySchema,
  type AgentPlanEntity,
  type AgentPlanHistoryEntity
} from '@shared/data/api/schemas/agentPlans'
import type { CursorPaginationResponse } from '@shared/data/api/types'

export function AgentHostPlan({ sessionId }: { sessionId: string }) {
  return <SavedPlan key={sessionId} sessionId={sessionId} />
}

function SavedPlan({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<AgentPlanEntity | null>(null)
  const [history, setHistory] = useState<CursorPaginationResponse<AgentPlanHistoryEntity> | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const request = useRef<symbol | null>(null)
  const historyRequest = useRef<symbol | null>(null)

  const load = useCallback(async () => {
    const token = Symbol()
    request.current = token
    historyRequest.current = null
    setPlan(null)
    setHistory(null)
    setShowHistory(false)
    setHistoryLoading(false)
    setHistoryError(false)
    setError(false)
    setLoading(true)
    try {
      const result = z
        .strictObject({ plan: AgentPlanEntitySchema.nullable() })
        .parse(await dataApiService.get(`/agent-sessions/${encodeURIComponent(sessionId)}/plan`))
      if (result.plan && result.plan.sessionId !== sessionId) throw new Error('Plan scope changed')
      if (request.current === token) setPlan(result.plan)
    } catch {
      if (request.current === token) setError(true)
    } finally {
      if (request.current === token) setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
    return () => {
      request.current = null
      historyRequest.current = null
    }
  }, [load])
  useDataChange(['/agent-sessions/:sessionId/plan', '/agent-sessions/:sessionId/plan/history'], () => void load(), {
    routeParams: { sessionId }
  })

  const loadHistory = async (cursor?: string) => {
    if (historyLoading || !plan) return
    const token = Symbol()
    historyRequest.current = token
    setHistoryLoading(true)
    setHistoryError(false)
    try {
      const result = z
        .object({ items: z.array(AgentPlanHistoryEntitySchema).max(5), nextCursor: z.string().optional() })
        .parse(
          await dataApiService.get(`/agent-sessions/${encodeURIComponent(sessionId)}/plan/history`, {
            query: { limit: 5, ...(cursor ? { cursor } : {}) }
          })
        )
      if (result.items.some((entry) => entry.planId !== plan.id || entry.revision > plan.revision))
        throw new Error('History scope changed')
      if (historyRequest.current === token) setHistory(result)
    } catch {
      if (historyRequest.current === token) setHistoryError(true)
    } finally {
      if (historyRequest.current === token) setHistoryLoading(false)
    }
  }
  return (
    <section aria-label={t('agent.host_plan.title')} className="space-y-2 border-b border-border px-3 py-3 text-xs">
      <h3 className="font-medium">{t('agent.host_plan.title')}</h3>
      <p className="text-muted-foreground">{t('agent.host_plan.unsupported')}</p>
      {loading ? <p role="status">{t('common.loading')}</p> : null}
      {error ? <p role="alert">{t('agent.host_plan.unavailable')}</p> : null}
      {!loading && !error && !plan ? <p>{t('agent.host_plan.empty')}</p> : null}
      {plan && !error ? (
        <>
          <p>{t('agent.host_plan.revision', { revision: plan.revision })}</p>
          <p className="text-muted-foreground">{t('agent.host_plan.origin')}</p>
          <time dateTime={plan.updatedAt} className="block break-all text-muted-foreground">
            {plan.updatedAt}
          </time>
          <PlanSnapshot state={plan.state} />
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showHistory}
            onClick={() => {
              if (showHistory) {
                setShowHistory(false)
                historyRequest.current = null
                setHistoryLoading(false)
              } else {
                setShowHistory(true)
                void loadHistory()
              }
            }}>
            {t('agent.host_plan.history')}
          </Button>
          {showHistory ? (
            <div className="space-y-3" aria-label={t('agent.host_plan.history')}>
              <p className="text-muted-foreground">{t('agent.host_plan.history_explain')}</p>
              {historyLoading ? <p role="status">{t('common.loading')}</p> : null}
              {historyError ? (
                <>
                  <p role="alert">{t('agent.host_plan.history_error')}</p>
                  <Button size="sm" variant="outline" onClick={() => void loadHistory()}>
                    {t('common.refresh')}
                  </Button>
                </>
              ) : null}
              {!historyError && !historyLoading && history?.items.length === 0 ? (
                <p>{t('agent.host_plan.no_history')}</p>
              ) : null}
              {!historyError && !historyLoading
                ? history?.items.map((entry) => (
                    <article key={entry.id} className="space-y-1 border-t border-border pt-2">
                      <h4>{t('agent.host_plan.revision', { revision: entry.revision })}</h4>
                      <p className="text-muted-foreground">{t('agent.host_plan.origin')}</p>
                      <time dateTime={entry.createdAt} className="block break-all text-muted-foreground">
                        {entry.createdAt}
                      </time>
                      <PlanSnapshot state={entry.state} />
                    </article>
                  ))
                : null}
              {!historyError && history?.nextCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={historyLoading}
                  onClick={() => void loadHistory(history.nextCursor)}>
                  {t('agent.host_plan.older')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
        {t('common.refresh')}
      </Button>
    </section>
  )
}

function PlanSnapshot({ state }: { state: AgentPlanEntity['state'] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 break-words whitespace-pre-wrap">
      <p>{state.objective}</p>
      <ol className="space-y-2">
        {state.steps.map((step, index) => (
          <li key={step.id} className="space-y-1 border-l border-border pl-2">
            <p>
              {index + 1}. {step.title}
            </p>
            <p className="text-muted-foreground">
              {t(
                {
                  pending: 'agent.host_plan.status.pending',
                  'in-progress': 'agent.host_plan.status.in-progress',
                  completed: 'agent.host_plan.status.completed',
                  error: 'agent.host_plan.status.error'
                }[step.status]
              )}
            </p>
            <p className="break-all text-muted-foreground">{t('agent.host_plan.step_id', { id: step.id })}</p>
            {step.dependencyIds.length ? (
              <p className="break-all text-muted-foreground">
                {t('agent.host_plan.dependencies', { ids: step.dependencyIds.join(', ') })}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
