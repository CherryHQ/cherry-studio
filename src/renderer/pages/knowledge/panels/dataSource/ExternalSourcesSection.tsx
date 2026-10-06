import { AlertCircle, ArrowLeft, ChevronRight, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NormalTooltip,
  PageSidePanel,
  PageSidePanelSection,
  Switch
} from '@cherrystudio/ui'
import { useDataChange, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import { useJob, useJobProgress } from '@renderer/hooks/useJob'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ExternalKnowledgeSourceListItem } from '@shared/data/api/schemas/externalKnowledge'
import type { ExternalKnowledgeConnectionListItem } from '@shared/data/api/schemas/externalKnowledgeConnections'
import type { InputFor } from '@shared/ipc/types'

import FeishuAuthorizationStatus from '../../components/FeishuAuthorizationStatus'
import FeishuConnectionForm from '../../components/FeishuConnectionForm'

const sourceListPath = '/knowledge-bases/:id/external-knowledge-sources'

const SourceJobStatus = ({ jobId }: { jobId: string }) => {
  const { t } = useTranslation()
  const { data: job } = useJob(jobId)
  const { detail } = useJobProgress(jobId)
  const progress = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : null
  const stage = typeof progress?.stage === 'string' ? progress.stage : null
  const stageLabel =
    stage === 'reading'
      ? t('knowledge.external.sources.stage_reading')
      : stage === 'embedding'
        ? t('knowledge.external.sources.stage_embedding')
        : stage === 'writing'
          ? t('knowledge.external.sources.stage_writing')
          : null
  const status = job?.status ?? 'pending'
  const statusLabel = (() => {
    switch (status) {
      case 'running':
        return t('knowledge.external.sources.job_running')
      case 'completed':
        return t('knowledge.external.sources.job_completed')
      case 'failed':
        return t('knowledge.external.sources.job_failed')
      case 'cancelled':
        return t('knowledge.external.sources.job_cancelled')
      case 'delayed':
        return t('knowledge.external.sources.job_delayed')
      default:
        return t('knowledge.external.sources.job_pending')
    }
  })()

  return (
    <span role="status" className="text-muted-foreground text-xs leading-5">
      {statusLabel}
      {stageLabel ? ` · ${t('knowledge.external.sources.job_phase', { phase: stageLabel })}` : null}
    </span>
  )
}

const formatTime = (value: string | null, locale: string, fallback: string) =>
  value ? new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : fallback

const SourceStatus = ({
  source,
  connection
}: {
  source: ExternalKnowledgeSourceListItem
  connection?: ExternalKnowledgeConnectionListItem
}) => {
  const { t } = useTranslation()
  if (source.state === 'paused' || connection?.authorizationStatus === 'reauthorization-required') {
    return (
      <Badge className="border-warning-border bg-warning-subtle text-warning-subtle-foreground">
        {t('knowledge.external.sources.paused')}
      </Badge>
    )
  }
  if (source.activeJobId) {
    return (
      <Badge variant="secondary" className="max-w-full whitespace-normal">
        <SourceJobStatus jobId={source.activeJobId} />
      </Badge>
    )
  }
  if (source.lastOutcome === 'failed') {
    return (
      <Badge className="bg-error-subtle text-error-subtle-foreground border-error-border">
        {t('knowledge.external.sources.job_failed')}
      </Badge>
    )
  }
  if (source.lastOutcome === 'completed-with-warnings') {
    return (
      <Badge className="border-warning-border bg-warning-subtle text-warning-subtle-foreground max-w-full whitespace-normal">
        {t('knowledge.external.sources.completed_with_warnings')}
      </Badge>
    )
  }
  return <Badge variant="secondary">{t('knowledge.external.sources.ready')}</Badge>
}

const SourceSyncFailure = ({ source }: { source: ExternalKnowledgeSourceListItem }) => {
  const { t } = useTranslation()
  if (source.lastOutcome !== 'failed' || source.activeJobId) return null
  const message = (() => {
    switch (source.lastErrorSummary) {
      case 'timeout':
        return t('knowledge.external.sources.sync_failure.timeout')
      case 'credential-unavailable':
      case 'reauthorization-required':
      case 'authorization-failed':
        return t('knowledge.external.sources.sync_failure.authorization')
      case 'scope-missing':
      case 'resource-permission-denied':
        return t('knowledge.external.sources.sync_failure.permission')
      case 'scope-not-found':
        return t('knowledge.external.sources.sync_failure.unavailable')
      case 'transient':
        return t('knowledge.external.sources.sync_failure.transient')
      default:
        return t('knowledge.external.sources.sync_failure.failed')
    }
  })()
  return (
    <p role="alert" className="text-error text-xs leading-5 wrap-anywhere">
      {message}
    </p>
  )
}

const SourceIssues = ({ sourceId }: { sourceId: string }) => {
  const { t } = useTranslation()
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery(
    '/external-knowledge-sources/:id/documents',
    {
      params: { id: sourceId },
      limit: 200
    }
  )
  useDataChange('/external-knowledge-sources/:id/documents', () => void refresh(), {
    routeParams: { id: sourceId }
  })
  const issues = pages
    .flatMap((page) => page.items)
    .filter((item) => item.availability === 'unavailable' || item.currentWarning)
  if (!isLoading && !error && !hasNext && issues.length === 0) return null
  const warningMessage = (warning: string | null) => {
    switch (warning) {
      case 'resource-permission-denied':
        return t('knowledge.external.sources.sync_failure.permission')
      case 'transient':
        return t('knowledge.external.sources.sync_failure.transient')
      case 'invalid-provider-response':
        return t('knowledge.external.sources.issue_invalid_response')
      case 'unsupported-resource':
        return t('knowledge.external.sources.issue_unsupported')
      case 'document-sync-failed':
        return t('knowledge.external.sources.issue_sync_failed')
      default:
        return t('knowledge.external.sources.issue_warning')
    }
  }

  return (
    <PageSidePanelSection title={t('knowledge.external.sources.issues')} className="pt-4">
      {isLoading ? <p className="text-muted-foreground text-sm leading-6">{t('common.loading')}</p> : null}
      {error ? (
        <div role="alert" className="space-y-2">
          <p className="text-error text-sm leading-6">{t('knowledge.external.sources.issues_error')}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {issues.map((item) => (
        <div key={item.id} className="space-y-1 rounded-md border border-border p-3 text-sm leading-6">
          <p className="font-medium wrap-anywhere">{item.title}</p>
          <p className="text-muted-foreground text-xs leading-5">
            {item.availability === 'unavailable'
              ? t('knowledge.external.sources.issue_unavailable')
              : warningMessage(item.currentWarning)}
          </p>
          {item.availability === 'unavailable' && item.currentWarning ? (
            <p className="text-muted-foreground text-xs leading-5">{warningMessage(item.currentWarning)}</p>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void window.api.shell.openExternal(item.originalUrl)}>
            <ExternalLink className="size-3.5" />
            {t('knowledge.external.sources.view_in_feishu')}
          </Button>
        </div>
      ))}
      {hasNext ? (
        <Button variant="outline" size="sm" loading={isRefreshing} onClick={loadNext}>
          {t('knowledge.external.sources.load_more_issues')}
        </Button>
      ) : null}
    </PageSidePanelSection>
  )
}

interface ExternalSourcesSectionProps {
  baseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddSource: () => void
  canAddSource: boolean
}

const ExternalSourcesSection = ({
  baseId,
  open,
  onOpenChange,
  onAddSource,
  canAddSource
}: ExternalSourcesSectionProps) => {
  const { t, i18n } = useTranslation()
  const { data: sources, isLoading, error, refetch } = useQuery(sourceListPath, { params: { id: baseId } })
  const {
    data: connections,
    isLoading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections
  } = useQuery('/external-knowledge-connections')
  useDataChange(sourceListPath, () => void refetch(), { routeParams: { id: baseId } })
  useDataChange('/external-knowledge-connections', () => void refetchConnections())
  useEffect(() => {
    const timer = window.setInterval(() => void refetch(), 60_000)
    return () => window.clearInterval(timer)
  }, [refetch])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [newConnectionOpen, setNewConnectionOpen] = useState(false)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const sourceEntryRef = useRef<HTMLButtonElement>(null)
  const accountEntryRef = useRef<HTMLButtonElement>(null)
  const returnSourceId = useRef<string | null>(null)
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [disconnectMode, setDisconnectMode] = useState<'keep-local' | 'remove-local' | null>(null)
  const [removeConnectionId, setRemoveConnectionId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [policy, setPolicy] = useState<'manual' | 'daily'>('manual')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const savedPolicy = useRef<ExternalKnowledgeSourceListItem['schedule']['policy'] | null>(null)
  const [editConnectionId, setEditConnectionId] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [configError, setConfigError] = useState<string | null>(null)
  const [authSession, setAuthSession] = useState<{ id: string; uri: string; code: string } | null>(null)
  const authSessionId = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (authSessionId.current) {
        void ipcApi.request('knowledge.feishu.authorization.cancel', {
          authorizationSessionId: authSessionId.current
        })
      }
    }
  }, [])

  const isBusy = Boolean(busyId) || savingSchedule
  const dailyTimeMissing = policy === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)
  const selected = sources?.find((source) => source.id === selectedId)
  const disconnecting = sources?.find((source) => source.id === disconnectId)
  const connectionById = new Map(connections?.map((connection) => [connection.id, connection]) ?? [])
  const selectedConnection = selected ? connectionById.get(selected.connectionId) : undefined
  const editingConnection = connectionById.get(editConnectionId ?? '')
  const removingConnection = connectionById.get(removeConnectionId ?? '')
  const view = selected ? `source:${selected.id}` : connectionsOpen ? 'connections' : 'sources'
  const previousView = useRef({ open, view })
  useEffect(() => {
    const previous = previousView.current
    previousView.current = { open, view }
    if (!open || !previous.open || previous.view === view) return
    if (view === 'sources') (sourceEntryRef.current ?? accountEntryRef.current)?.focus()
    else backButtonRef.current?.focus()
  }, [open, view])

  const openSource = (source: ExternalKnowledgeSourceListItem) => {
    if (isBusy) return
    returnSourceId.current = source.id
    savedPolicy.current = source.schedule.policy
    setScheduleError(null)
    setSelectedId(source.id)
    onOpenChange(true)
    setPolicy(source.schedule.policy.kind)
    setDailyTime(source.schedule.policy.kind === 'daily' ? source.schedule.policy.time : '09:00')
  }
  const refresh = () => {
    void refetch()
    void refetchConnections()
  }
  const runSourceAction = async (
    sourceId: string,
    action: () => Promise<unknown>,
    errorKey: string
  ): Promise<boolean> => {
    if (isBusy) return false
    setBusyId(sourceId)
    try {
      await action()
      refresh()
      return true
    } catch (cause) {
      toast.error(formatErrorMessageWithPrefix(cause, t(errorKey)))
      return false
    } finally {
      setBusyId(null)
    }
  }
  const saveSchedule = async (kind: 'manual' | 'daily', time = dailyTime) => {
    const saved = savedPolicy.current
    if (!selected || !saved || savingSchedule || busyId) return false
    setPolicy(kind)
    setScheduleError(null)
    if (kind === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false
    const nextPolicy =
      kind === 'manual'
        ? ({ kind: 'manual' } as const)
        : ({
            kind: 'daily',
            time,
            timezone:
              saved.kind === 'daily' ? saved.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          } as const)
    if (JSON.stringify(nextPolicy) === JSON.stringify(saved)) return true
    setSavingSchedule(true)
    try {
      await ipcApi.request('knowledge.external_source.schedule.update', { sourceId: selected.id, policy: nextPolicy })
      savedPolicy.current = nextPolicy
      void refetch()
      return true
    } catch (cause) {
      setPolicy(saved.kind)
      setDailyTime(saved.kind === 'daily' ? saved.time : '09:00')
      setScheduleError(formatErrorMessageWithPrefix(cause, t('knowledge.external.sources.save_error')))
      return false
    } finally {
      setSavingSchedule(false)
    }
  }
  const disconnect = async (mode: 'keep-local' | 'remove-local') => {
    if (!disconnectId || isBusy) return
    const sourceId = disconnectId
    setDisconnectMode(mode)
    const didDisconnect = await runSourceAction(
      sourceId,
      () => ipcApi.request('knowledge.external_source.disconnect', { sourceId, mode }),
      'knowledge.external.sources.disconnect_error'
    )
    setDisconnectMode(null)
    if (didDisconnect) {
      setDisconnectId((current) => (current === sourceId ? null : current))
      setSelectedId((current) => (current === sourceId ? null : current))
    }
  }
  const cancelAuthorization = () => {
    if (authSessionId.current) {
      void ipcApi.request('knowledge.feishu.authorization.cancel', {
        authorizationSessionId: authSessionId.current
      })
      authSessionId.current = null
      setAuthSession(null)
    }
  }
  const reconnect = async (
    connection: ExternalKnowledgeConnectionListItem,
    credentials?: InputFor<'knowledge.feishu.connection.reconnect'>['credentials']
  ): Promise<boolean> => {
    if (isBusy) return false
    setBusyId(connection.id)
    let startedId: string | null = null
    try {
      setConfigError(null)
      const started = await ipcApi.request('knowledge.feishu.connection.reconnect', {
        connectionId: connection.id,
        ...(credentials ? { credentials } : {})
      })
      setEditConnectionId(null)
      setAppSecret('')
      startedId = started.authorizationSessionId
      authSessionId.current = started.authorizationSessionId
      setAuthSession({ id: started.authorizationSessionId, uri: started.verificationUri, code: started.userCode })
      await window.api.shell.openExternal(started.verificationUri)
      await ipcApi.request('knowledge.feishu.authorization.complete', {
        authorizationSessionId: started.authorizationSessionId
      })
      if (authSessionId.current !== started.authorizationSessionId) return false
      authSessionId.current = null
      setAuthSession(null)
      refresh()
      return true
    } catch (cause) {
      if (!startedId || authSessionId.current === startedId) {
        const message = formatErrorMessageWithPrefix(cause, t('knowledge.external.sources.reconnect_error'))
        if (credentials && !startedId) setConfigError(message)
        else toast.error(message)
      }
      if (authSessionId.current) {
        void ipcApi.request('knowledge.feishu.authorization.cancel', {
          authorizationSessionId: authSessionId.current
        })
        authSessionId.current = null
      }
      setAuthSession(null)
      return false
    } finally {
      setBusyId(null)
    }
  }

  const saveSelectedSchedule = async () => {
    if (isBusy) return false
    if (!selected || dailyTimeMissing) return true
    return await saveSchedule(policy)
  }
  const closeManager = async () => {
    if (!(await saveSelectedSchedule())) return
    onOpenChange(false)
    setSelectedId(null)
    setConnectionsOpen(false)
  }
  const goBack = async () => {
    if (!(await saveSelectedSchedule())) return
    setSelectedId(null)
    setConnectionsOpen(false)
  }
  const attentionCount =
    sources?.filter(
      (source) =>
        source.state === 'paused' ||
        connectionById.get(source.connectionId)?.authorizationStatus === 'reauthorization-required' ||
        (!source.activeJobId && (source.lastOutcome === 'failed' || source.lastOutcome === 'completed-with-warnings'))
    ).length ?? 0
  const syncingCount = sources?.filter((source) => source.activeJobId).length ?? 0
  const needsAttention = Boolean(error) || attentionCount > 0
  const statusLabel = error
    ? t('knowledge.external.sources.load_error')
    : attentionCount > 0
      ? t('knowledge.external.sources.attention_count', { count: attentionCount })
      : syncingCount > 0
        ? t('knowledge.external.sources.syncing_count', { count: syncingCount })
        : null
  const sourceAction = (source: ExternalKnowledgeSourceListItem) => {
    const connection = connectionById.get(source.connectionId)
    const needsReconnect = source.state === 'paused' || connection?.authorizationStatus === 'reauthorization-required'
    const sync = async () => {
      if (isBusy || source.activeJobId) return
      if (needsReconnect && (!connection || !(await reconnect(connection)))) return
      await runSourceAction(
        source.id,
        () => ipcApi.request('knowledge.external_source.sync', { sourceId: source.id }),
        'knowledge.external.sources.sync_error'
      )
    }
    return (
      <Button
        size="sm"
        disabled={isBusy || (needsReconnect && !connection) || Boolean(source.activeJobId)}
        onClick={() => void sync()}>
        <RefreshCw className="size-3.5" />
        {t('knowledge.external.sources.manual_sync')}
      </Button>
    )
  }
  const sourceList = (
    <div className="space-y-4 text-sm leading-6">
      {isLoading ? <p className="text-muted-foreground">{t('common.loading')}</p> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <span>{t('knowledge.external.sources.load_error')}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!isLoading && !error && sources?.length === 0 ? (
        <p className="text-muted-foreground">{t('knowledge.external.sources.empty')}</p>
      ) : null}
      {sources?.map((source) => {
        const connection = connectionById.get(source.connectionId)
        return (
          <div
            key={source.id}
            role="group"
            aria-label={source.name}
            className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium wrap-anywhere">{source.name}</p>
                <SourceStatus source={source} connection={connection} />
              </div>
              <p className="text-muted-foreground text-xs leading-5 wrap-anywhere">
                {connection?.displayName ??
                  connection?.applicationName ??
                  t('knowledge.external.sources.account_unknown')}
                {' · '}
                {source.scope.kind === 'space'
                  ? t('knowledge.external.sources.scope_space')
                  : source.scope.kind === 'node'
                    ? t('knowledge.external.sources.scope_node')
                    : t('knowledge.external.sources.scope_document')}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-5 wrap-anywhere">
                {t('knowledge.external.sources.last_success')}:{' '}
                {formatTime(source.lastSuccessfulSyncAt, i18n.language, t('knowledge.external.sources.never'))}
              </p>
              <Button
                ref={source.id === returnSourceId.current ? sourceEntryRef : undefined}
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={isBusy}
                onClick={() => openSource(source)}>
                {t('knowledge.external.sources.view_details')}
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
  const sourceDetails = selected ? (
    <div className="space-y-4 text-sm leading-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 font-medium wrap-anywhere">{selected.name}</p>
            <SourceStatus source={selected} connection={selectedConnection} />
          </div>
          <p className="text-muted-foreground text-xs leading-5 wrap-anywhere">
            {selectedConnection?.displayName ?? t('knowledge.external.sources.account_unknown')}
            {' · '}
            {selected.scope.kind === 'space'
              ? t('knowledge.external.sources.scope_space')
              : selected.scope.kind === 'node'
                ? t('knowledge.external.sources.scope_node')
                : t('knowledge.external.sources.scope_document')}
          </p>
        </div>
      </div>
      <PageSidePanelSection
        title={t('knowledge.external.sources.last_result')}
        role="region"
        aria-label={t('knowledge.external.sources.last_result')}
        className="pt-4">
        {selected.lastFinishedAt ? (
          <>
            <div className="space-y-1">
              <p>
                {selected.lastOutcome === 'failed'
                  ? t('knowledge.external.sources.job_failed')
                  : selected.lastOutcome === 'cancelled'
                    ? t('knowledge.external.sources.job_cancelled')
                    : selected.lastOutcome === 'completed-with-warnings'
                      ? t('knowledge.external.sources.completed_with_warnings')
                      : t('knowledge.external.sources.job_completed')}
              </p>
              <time dateTime={selected.lastFinishedAt} className="text-muted-foreground text-xs leading-5">
                {formatTime(selected.lastFinishedAt, i18n.language, t('knowledge.external.sources.never'))}
              </time>
            </div>
            <p className="text-xs leading-5">
              {t('knowledge.external.sources.sync_update_summary', { count: selected.lastIndexedCount ?? 0 })}
            </p>
            {(selected.lastWarningCount ?? 0) > 0 ? (
              <p className="text-warning-subtle-foreground text-xs leading-5">
                {t('knowledge.external.sources.sync_attention_summary', { count: selected.lastWarningCount ?? 0 })}
              </p>
            ) : null}
            <Accordion key={selected.id} type="single" collapsible>
              <AccordionItem value="sync-details" className="first:border-t-0">
                <AccordionTrigger className="text-muted-foreground min-h-10 py-0 text-xs font-normal">
                  {t('knowledge.external.sources.sync_details')}
                </AccordionTrigger>
                <AccordionContent>
                  <dl className="space-y-2 text-xs leading-5">
                    {(
                      [
                        [t('knowledge.external.sources.unchanged'), selected.lastUnchangedCount],
                        [t('knowledge.external.sources.skipped'), selected.lastSkippedCount]
                      ] as const
                    ).map(([label, count]) => (
                      <div key={label} className="flex items-start justify-between gap-3">
                        <dt className="text-muted-foreground wrap-anywhere">{label}</dt>
                        <dd className="text-foreground tabular-nums">{count ?? 0}</dd>
                      </div>
                    ))}
                  </dl>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        ) : (
          <p className="text-muted-foreground text-xs leading-5">{t('knowledge.external.sources.never')}</p>
        )}
        <SourceSyncFailure source={selected} />
      </PageSidePanelSection>
      <div
        role="region"
        aria-label={t('knowledge.external.sources.sync_settings')}
        aria-busy={savingSchedule}
        className="space-y-3 pt-4">
        <div
          className="space-y-3"
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
            void saveSchedule(policy)
          }}>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="external-source-auto-sync">{t('knowledge.external.sources.auto_sync')}</Label>
            <Switch
              id="external-source-auto-sync"
              checked={policy === 'daily'}
              onCheckedChange={(checked) => void saveSchedule(checked ? 'daily' : 'manual')}
              disabled={Boolean(busyId) || savingSchedule}
              loading={savingSchedule}
            />
          </div>
          {policy === 'daily' ? (
            <div className="space-y-2">
              <Label htmlFor="external-source-time">{t('knowledge.external.wizard.daily_time')}</Label>
              <Input
                id="external-source-time"
                type="time"
                required
                disabled={Boolean(busyId) || savingSchedule}
                aria-invalid={dailyTimeMissing || undefined}
                aria-describedby={dailyTimeMissing ? 'external-source-time-error' : undefined}
                value={dailyTime}
                onChange={(event) => setDailyTime(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              {dailyTimeMissing ? (
                <p id="external-source-time-error" role="alert" className="text-error text-xs leading-5">
                  {t('common.required_field')}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs leading-5">
                {t('knowledge.external.wizard.timezone', {
                  timezone:
                    selected.schedule.policy.kind === 'daily'
                      ? selected.schedule.policy.timezone
                      : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
                })}
              </p>
            </div>
          ) : null}
        </div>
        {scheduleError ? (
          <p role="alert" className="text-error text-xs leading-5">
            {scheduleError}
          </p>
        ) : null}
      </div>
      <SourceIssues sourceId={selected.id} />
      <Accordion key={selected.id} type="single" collapsible>
        <AccordionItem value="source-info" className="first:border-t-0">
          <AccordionTrigger>{t('knowledge.external.sources.info')}</AccordionTrigger>
          <AccordionContent>
            <dl className="space-y-3 text-xs leading-5">
              <div className="space-y-1">
                <dt className="text-muted-foreground">{t('knowledge.external.sources.space_id')}</dt>
                <dd className="wrap-anywhere">{selected.spaceId}</dd>
              </div>
              {selected.scope.kind !== 'space' ? (
                <div className="space-y-1">
                  <dt className="text-muted-foreground">{t('knowledge.external.sources.node_id')}</dt>
                  <dd className="wrap-anywhere">{selected.scope.nodeId}</dd>
                </div>
              ) : null}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  ) : null
  const accountList = (
    <div className="space-y-3 text-sm leading-6">
      {connectionsLoading ? <p className="text-muted-foreground">{t('common.loading')}</p> : null}
      {connectionsError ? (
        <div role="alert" className="space-y-2">
          <p className="text-error">{t('knowledge.external.wizard.connection_error')}</p>
          <Button variant="outline" size="sm" onClick={() => void refetchConnections()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!connectionsLoading && !connectionsError && connections?.length === 0 ? (
        <p className="text-muted-foreground">{t('knowledge.external.wizard.no_connections')}</p>
      ) : null}
      {connections?.map((connection) => (
        <div key={connection.id} className="space-y-1 rounded-lg border border-border p-3">
          <p className="font-medium wrap-anywhere">{connection.applicationName || connection.appId}</p>
          <p className="text-muted-foreground text-xs leading-5 wrap-anywhere">
            {t('knowledge.external.wizard.authorized_account', {
              name: connection.displayName || t('knowledge.external.sources.account_unknown')
            })}
          </p>
          <p className="text-muted-foreground text-xs leading-5">
            {t('knowledge.external.sources.connection_count', { count: connection.sourceCount })} ·{' '}
            {connection.authorizationStatus === 'connected'
              ? t('knowledge.external.sources.connection_connected')
              : connection.authorizationStatus === 'reauthorization-required'
                ? t('knowledge.external.sources.connection_reauthorization_required')
                : t('knowledge.external.sources.connection_pending_authorization')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connection.appCredentialSource === 'custom-app' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  setAppId(connection.appId)
                  setAppSecret('')
                  setConfigError(null)
                  setEditConnectionId(connection.id)
                }}>
                {t('knowledge.external.sources.edit_connection')}
              </Button>
            ) : null}
            {connection.authorizationStatus === 'reauthorization-required' ? (
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void reconnect(connection)}>
                {t('knowledge.external.sources.reconnect')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={connection.sourceCount > 0 || isBusy}
              onClick={() => setRemoveConnectionId(connection.id)}>
              {t('common.delete')}
            </Button>
          </div>
          {connection.sourceCount > 0 ? (
            <p className="text-muted-foreground text-xs leading-5">
              {t('knowledge.external.sources.connection_in_use')}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )

  return (
    <>
      {statusLabel ? (
        <NormalTooltip content={statusLabel}>
          <Button
            variant="ghost"
            size="sm"
            aria-hidden={open || undefined}
            inert={open}
            disabled={isBusy}
            className="h-7 max-w-full min-w-0 gap-1 px-1 text-xs"
            onClick={() => onOpenChange(true)}>
            {needsAttention ? <AlertCircle className="lucide-custom size-3 shrink-0 text-warning" /> : null}
            <span
              role={needsAttention ? 'alert' : 'status'}
              className={needsAttention ? 'truncate text-warning' : 'text-muted-foreground truncate'}>
              {statusLabel}
            </span>
          </Button>
        </NormalTooltip>
      ) : null}
      <PageSidePanel
        open={open}
        onClose={() => void closeManager()}
        showCloseButton={!isBusy}
        title={t('knowledge.external.sources.title')}
        header={
          selected || connectionsOpen ? (
            <div
              className="flex min-w-0 items-center gap-2"
              aria-label={t(
                selected ? 'knowledge.external.sources.details' : 'knowledge.external.sources.connections'
              )}>
              <NormalTooltip content={t('common.back')}>
                <Button
                  ref={backButtonRef}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.back')}
                  disabled={isBusy}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void goBack()}>
                  <ArrowLeft className="size-3.5" />
                </Button>
              </NormalTooltip>
              <span className="text-base font-semibold wrap-anywhere">
                {t(selected ? 'knowledge.external.sources.details' : 'knowledge.external.sources.connections')}
              </span>
            </div>
          ) : undefined
        }
        closeLabel={t('common.close')}
        footer={
          !selected && !connectionsOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy || !canAddSource}
                onClick={() => {
                  onOpenChange(false)
                  onAddSource()
                }}>
                <Plus className="size-3.5" />
                {t('knowledge.external.sources.add_source')}
              </Button>
              <Button
                ref={accountEntryRef}
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  returnSourceId.current = null
                  setConnectionsOpen(true)
                }}>
                {t('knowledge.external.sources.manage_connections')}
              </Button>
            </div>
          ) : selected ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setDisconnectId(selected.id)}>
                {t('knowledge.external.sources.disconnect')}
              </Button>
              <div className="ml-auto">{sourceAction(selected)}</div>
            </div>
          ) : connectionsOpen ? (
            <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setNewConnectionOpen(true)}>
              <Plus className="size-3.5" />
              {t('knowledge.external.wizard.connect_application')}
            </Button>
          ) : undefined
        }>
        {selected ? sourceDetails : connectionsOpen ? accountList : sourceList}
      </PageSidePanel>
      {newConnectionOpen ? (
        <Dialog open onOpenChange={(nextOpen) => !nextOpen && setNewConnectionOpen(false)}>
          <DialogContent
            closeLabel={t('common.close')}
            closeOnOverlayClick={false}
            aria-describedby={undefined}
            className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>{t('knowledge.external.wizard.connect_application')}</DialogTitle>
            </DialogHeader>
            <FeishuConnectionForm
              onCancel={() => setNewConnectionOpen(false)}
              onConnected={() => {
                setNewConnectionOpen(false)
                void refetchConnections()
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      <Dialog open={Boolean(disconnecting)} onOpenChange={(open) => !open && !isBusy && setDisconnectId(null)}>
        <DialogContent showCloseButton={!isBusy} closeOnOverlayClick={!isBusy} closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('knowledge.external.sources.disconnect_title')}</DialogTitle>
            <DialogDescription>
              {t('knowledge.external.sources.disconnect_description', { name: disconnecting?.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Button
              variant="outline"
              className="w-full"
              loading={disconnectMode === 'keep-local'}
              disabled={Boolean(busyId)}
              onClick={() => void disconnect('keep-local')}>
              {t('knowledge.external.sources.keep_local')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('knowledge.external.sources.keep_local_hint')}</p>
          </div>
          <div className="space-y-1">
            <Button
              variant="destructive"
              className="w-full"
              loading={disconnectMode === 'remove-local'}
              disabled={Boolean(busyId)}
              onClick={() => void disconnect('remove-local')}>
              {t('knowledge.external.sources.remove_local')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('knowledge.external.sources.remove_local_hint')}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={isBusy} onClick={() => setDisconnectId(null)}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(removeConnectionId)}
        onOpenChange={(open) => !open && !isBusy && setRemoveConnectionId(null)}
        confirmLoading={Boolean(removeConnectionId && busyId === removeConnectionId)}
        cancelDisabled={isBusy}
        title={t('knowledge.external.sources.remove_connection_title')}
        description={t('knowledge.external.sources.remove_connection_description', {
          name: removingConnection?.displayName ?? removingConnection?.applicationName ?? removingConnection?.appId
        })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (!removeConnectionId || isBusy) return false
          const id = removeConnectionId
          const didRemove = await runSourceAction(
            id,
            () => ipcApi.request('knowledge.feishu.connection.remove', { connectionId: id }),
            'knowledge.external.sources.remove_connection_error'
          )
          if (didRemove) setRemoveConnectionId(null)
          return didRemove
        }}
      />
      <Dialog
        open={Boolean(editingConnection)}
        onOpenChange={(open) => {
          if (!open && !isBusy) {
            setEditConnectionId(null)
            setAppSecret('')
          }
        }}>
        <DialogContent
          showCloseButton={!isBusy}
          closeOnOverlayClick={!isBusy}
          closeLabel={t('common.close')}
          className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('knowledge.external.sources.edit_connection')}</DialogTitle>
            <DialogDescription>
              {t('knowledge.external.sources.edit_connection_description', {
                name: editingConnection?.displayName ?? editingConnection?.applicationName ?? editingConnection?.appId
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="external-connection-app-id">{t('knowledge.external.wizard.custom_app_id')}</Label>
            <Input
              id="external-connection-app-id"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              maxLength={256}
              disabled={isBusy}
            />
            <Label htmlFor="external-connection-app-secret">{t('knowledge.external.wizard.custom_app_secret')}</Label>
            <Input
              id="external-connection-app-secret"
              type="password"
              autoComplete="new-password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
              maxLength={1024}
              disabled={isBusy}
            />
            {configError ? (
              <p role="alert" className="text-error text-sm">
                {configError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={isBusy}
              onClick={() => {
                setEditConnectionId(null)
                setAppSecret('')
              }}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={isBusy || !appId.trim() || !appSecret.trim()}
              loading={Boolean(editConnectionId && busyId === editConnectionId)}
              onClick={() => {
                if (editingConnection)
                  void reconnect(editingConnection, { kind: 'custom-app', appId: appId.trim(), appSecret })
              }}>
              {t('knowledge.external.sources.save_and_reconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(authSession)}
        onOpenChange={(open) => {
          if (!open) cancelAuthorization()
        }}>
        <DialogContent closeLabel={t('common.close')} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('knowledge.external.sources.reconnect')}</DialogTitle>
          </DialogHeader>
          {authSession ? (
            <FeishuAuthorizationStatus
              userCode={authSession.code}
              verificationUri={authSession.uri}
              onCancel={cancelAuthorization}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default ExternalSourcesSection
