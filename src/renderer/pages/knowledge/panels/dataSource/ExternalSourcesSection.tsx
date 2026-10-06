import { AlertCircle, ArrowLeft, Link2Off, Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
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
  SegmentedControl
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
    <span role="status" className="text-muted-foreground text-xs">
      {statusLabel}
      {stageLabel ? ` · ${t('knowledge.external.sources.job_phase', { phase: stageLabel })}` : null}
    </span>
  )
}

const formatTime = (value: string | null, locale: string, fallback: string) =>
  value ? new Date(value).toLocaleString(locale) : fallback

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
    <p role="alert" className="text-error text-xs wrap-anywhere">
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

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-sm font-medium">{t('knowledge.external.sources.issues')}</h3>
      {isLoading ? <p className="text-muted-foreground text-sm">{t('common.loading')}</p> : null}
      {error ? (
        <div role="alert" className="space-y-2">
          <p className="text-error text-sm">{t('knowledge.external.sources.issues_error')}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!isLoading && !error && !hasNext && issues.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('knowledge.external.sources.no_issues')}</p>
      ) : null}
      {issues.map((item) => (
        <div key={item.id} className="rounded-md border border-border p-2 text-sm">
          <p className="font-medium wrap-anywhere">{item.title}</p>
          <p className="text-muted-foreground text-xs">
            {item.availability === 'unavailable'
              ? t('knowledge.external.sources.issue_unavailable')
              : t('knowledge.external.sources.issue_warning')}
          </p>
        </div>
      ))}
      {hasNext ? (
        <Button variant="outline" size="sm" loading={isRefreshing} onClick={loadNext}>
          {t('knowledge.external.sources.load_more_issues')}
        </Button>
      ) : null}
    </section>
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
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<'manual' | 'daily'>('manual')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [savingName, setSavingName] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const savedSettings = useRef<{ name: string; policy: ExternalKnowledgeSourceListItem['schedule']['policy'] } | null>(
    null
  )
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

  const isBusy = Boolean(busyId) || savingName || savingSchedule
  const dailyTimeMissing = policy === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)
  const selected = sources?.find((source) => source.id === selectedId)
  const disconnecting = sources?.find((source) => source.id === disconnectId)
  const connectionById = new Map(connections?.map((connection) => [connection.id, connection]) ?? [])
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
    savedSettings.current = { name: source.name, policy: source.schedule.policy }
    setNameError(null)
    setScheduleError(null)
    setSelectedId(source.id)
    onOpenChange(true)
    setName(source.name)
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
  const saveName = async () => {
    const saved = savedSettings.current
    if (!selected || !saved || savingName || busyId) return false
    const nextName = name.trim()
    if (!nextName) {
      setNameError(t('knowledge.external.sources.name_required'))
      return false
    }
    if (nextName === saved.name) return true
    setSavingName(true)
    setNameError(null)
    try {
      await ipcApi.request('knowledge.external_source.rename', { sourceId: selected.id, name: nextName })
      saved.name = nextName
      setName(nextName)
      void refetch()
      return true
    } catch (cause) {
      setName(saved.name)
      setNameError(formatErrorMessageWithPrefix(cause, t('knowledge.external.sources.save_error')))
      return false
    } finally {
      setSavingName(false)
    }
  }
  const saveSchedule = async (kind: 'manual' | 'daily', time = dailyTime) => {
    const saved = savedSettings.current
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
              saved.policy.kind === 'daily'
                ? saved.policy.timezone
                : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          } as const)
    if (JSON.stringify(nextPolicy) === JSON.stringify(saved.policy)) return true
    setSavingSchedule(true)
    try {
      await ipcApi.request('knowledge.external_source.schedule.update', { sourceId: selected.id, policy: nextPolicy })
      saved.policy = nextPolicy
      void refetch()
      return true
    } catch (cause) {
      setPolicy(saved.policy.kind)
      setDailyTime(saved.policy.kind === 'daily' ? saved.policy.time : '09:00')
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
  ) => {
    if (isBusy) return
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
      if (authSessionId.current !== started.authorizationSessionId) return
      authSessionId.current = null
      setAuthSession(null)
      refresh()
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
    } finally {
      setBusyId(null)
    }
  }

  const saveSelectedSettings = async () => {
    if (isBusy) return false
    if (!selected) return true
    const results = await Promise.all([
      name.trim() ? saveName() : undefined,
      !dailyTimeMissing ? saveSchedule(policy) : undefined
    ])
    return results.every((result) => result !== false)
  }
  const closeManager = async () => {
    if (!(await saveSelectedSettings())) return
    onOpenChange(false)
    setSelectedId(null)
    setConnectionsOpen(false)
  }
  const goBack = async () => {
    if (!(await saveSelectedSettings())) return
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
  const sourceList = (
    <div className="space-y-3">
      {isLoading ? <p className="text-muted-foreground text-sm">{t('common.loading')}</p> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('knowledge.external.sources.load_error')}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!isLoading && !error && sources?.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('knowledge.external.sources.empty')}</p>
      ) : null}
      <div className="space-y-3">
        {sources?.map((source) => {
          const connection = connectionById.get(source.connectionId)
          return (
            <div key={source.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Button
                    ref={source.id === returnSourceId.current ? sourceEntryRef : undefined}
                    variant="ghost"
                    size="sm"
                    className="h-auto max-w-full min-w-0 justify-start p-0 text-left font-medium hover:underline"
                    disabled={isBusy}
                    onClick={() => openSource(source)}>
                    <span className="wrap-anywhere whitespace-normal">{source.name}</span>
                  </Button>
                  <p className="text-muted-foreground truncate text-xs">
                    {connection?.displayName ??
                      connection?.applicationName ??
                      t('knowledge.external.sources.account_unknown')}
                    {' · '}
                    {source.scope.kind === 'space'
                      ? t('knowledge.external.sources.scope_space')
                      : source.scope.kind === 'node'
                        ? t('knowledge.external.sources.scope_node')
                        : t('knowledge.external.sources.scope_document')}
                    {' · '}
                    {source.spaceId}
                  </p>
                  {source.state === 'paused' ? (
                    <p className="text-muted-foreground text-xs">{t('knowledge.external.sources.sync_paused')}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <NormalTooltip content={t('knowledge.external.sources.sync_now')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('knowledge.external.sources.sync_now')}
                      disabled={isBusy || source.state === 'paused' || Boolean(source.activeJobId)}
                      onClick={() =>
                        void runSourceAction(
                          source.id,
                          () => ipcApi.request('knowledge.external_source.sync', { sourceId: source.id }),
                          'knowledge.external.sources.sync_error'
                        )
                      }>
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </NormalTooltip>
                  <NormalTooltip content={t('common.settings')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('common.settings')}
                      disabled={isBusy}
                      onClick={() => openSource(source)}>
                      <Settings2 className="size-3.5" />
                    </Button>
                  </NormalTooltip>
                  <NormalTooltip content={t('knowledge.external.sources.disconnect')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('knowledge.external.sources.disconnect')}
                      disabled={isBusy}
                      onClick={() => setDisconnectId(source.id)}>
                      <Link2Off className="size-3.5" />
                    </Button>
                  </NormalTooltip>
                </div>
              </div>
              <SourceSyncFailure source={source} />
              {source.lastOutcome === 'failed' && !source.activeJobId && source.state !== 'paused' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={isBusy}
                  onClick={() =>
                    void runSourceAction(
                      source.id,
                      () => ipcApi.request('knowledge.external_source.sync', { sourceId: source.id }),
                      'knowledge.external.sources.sync_error'
                    )
                  }>
                  {t('knowledge.external.sources.retry_sync')}
                </Button>
              ) : null}
              {source.activeJobId ? <SourceJobStatus jobId={source.activeJobId} /> : null}
              {source.lastFinishedAt ? (
                <p className="text-muted-foreground text-xs">
                  {source.lastOutcome === 'failed'
                    ? t('knowledge.external.sources.job_failed')
                    : source.lastOutcome === 'cancelled'
                      ? t('knowledge.external.sources.job_cancelled')
                      : source.lastOutcome === 'completed-with-warnings'
                        ? t('knowledge.external.sources.completed_with_warnings')
                        : t('knowledge.external.sources.job_completed')}
                  {' · '}
                  {t('knowledge.external.sources.summary', {
                    indexed: source.lastIndexedCount ?? 0,
                    unchanged: source.lastUnchangedCount ?? 0,
                    skipped: source.lastSkippedCount ?? 0,
                    warnings: source.lastWarningCount ?? 0
                  })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {t('knowledge.external.sources.last_success')}:{' '}
                {formatTime(source.lastSuccessfulSyncAt, i18n.language, t('knowledge.external.sources.never'))} ·{' '}
                {t('knowledge.external.sources.next_run')}:{' '}
                {formatTime(source.schedule.nextRunAt, i18n.language, t('knowledge.external.sources.never'))}
              </p>
              {connection?.authorizationStatus === 'reauthorization-required' ? (
                <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void reconnect(connection)}>
                  {t('knowledge.external.sources.reconnect')}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
  const sourceDetails = selected ? (
    <div className="space-y-5 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{t('knowledge.external.sources.scope')}</p>
        <p className="text-muted-foreground wrap-anywhere">
          {selected.scope.kind === 'space'
            ? t('knowledge.external.sources.scope_space')
            : selected.scope.kind === 'node'
              ? t('knowledge.external.sources.scope_node')
              : t('knowledge.external.sources.scope_document')}{' '}
          · {selected.spaceId}
          {selected.scope.kind !== 'space' ? ` · ${selected.scope.nodeId}` : ''}
        </p>
      </div>
      <div className="space-y-1">
        <p className="font-medium">{t('knowledge.external.sources.account')}</p>
        <p className="text-muted-foreground wrap-anywhere">
          {connectionById.get(selected.connectionId)?.displayName ?? t('knowledge.external.sources.account_unknown')}
        </p>
      </div>
      <SourceSyncFailure source={selected} />
      {selected.lastOutcome === 'failed' && !selected.activeJobId && selected.state !== 'paused' ? (
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() =>
            void runSourceAction(
              selected.id,
              () => ipcApi.request('knowledge.external_source.sync', { sourceId: selected.id }),
              'knowledge.external.sources.sync_error'
            )
          }>
          {t('knowledge.external.sources.retry_sync')}
        </Button>
      ) : null}
      {connectionById.get(selected.connectionId)?.authorizationStatus === 'reauthorization-required' ? (
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() => {
            const connection = connectionById.get(selected.connectionId)
            if (connection) void reconnect(connection)
          }}>
          {t('knowledge.external.sources.reconnect')}
        </Button>
      ) : null}
      {selected.state === 'paused' ? (
        <p className="text-muted-foreground text-xs">{t('knowledge.external.sources.sync_paused')}</p>
      ) : null}
      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="font-medium">{t('common.settings')}</h3>
        <Label htmlFor="external-source-name">{t('knowledge.external.wizard.name')}</Label>
        <Input
          id="external-source-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNameError(null)
          }}
          onBlur={() => void saveName()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          maxLength={256}
          disabled={Boolean(busyId) || savingName}
          aria-invalid={Boolean(nameError) || undefined}
          aria-describedby={nameError ? 'external-source-name-error' : undefined}
        />
        {nameError ? (
          <p id="external-source-name-error" role="alert" className="text-error text-xs">
            {nameError}
          </p>
        ) : null}
        <div
          className="space-y-2"
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
            void saveSchedule(policy)
          }}>
          <div className="space-y-1.5">
            <p className="font-medium">{t('knowledge.external.wizard.sync_frequency')}</p>
            <SegmentedControl<'manual' | 'daily'>
              aria-label={t('knowledge.external.wizard.sync_frequency')}
              options={[
                { value: 'manual', label: t('knowledge.external.wizard.manual') },
                { value: 'daily', label: t('knowledge.external.wizard.daily') }
              ]}
              value={policy}
              onValueChange={(value) => void saveSchedule(value)}
              disabled={Boolean(busyId) || savingSchedule}
              size="sm"
            />
          </div>
          {policy === 'daily' ? (
            <>
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
                <p id="external-source-time-error" role="alert" className="text-error text-xs">
                  {t('common.required_field')}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {t('knowledge.external.wizard.timezone', {
                  timezone:
                    selected.schedule.policy.kind === 'daily'
                      ? selected.schedule.policy.timezone
                      : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
                })}
              </p>
            </>
          ) : null}
        </div>
        <p role="status" className="text-muted-foreground text-xs">
          {savingName || savingSchedule
            ? t('knowledge.external.sources.saving')
            : t('knowledge.external.sources.auto_save')}
        </p>
        {scheduleError ? (
          <p role="alert" className="text-error text-xs">
            {scheduleError}
          </p>
        ) : null}
      </div>
      <SourceIssues sourceId={selected.id} />
      <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setDisconnectId(selected.id)}>
        {t('knowledge.external.sources.disconnect')}
      </Button>
    </div>
  ) : null
  const accountList = (
    <div className="space-y-2">
      {connectionsLoading ? <p className="text-muted-foreground text-sm">{t('common.loading')}</p> : null}
      {connectionsError ? (
        <div role="alert" className="space-y-2">
          <p className="text-error text-sm">{t('knowledge.external.wizard.connection_error')}</p>
          <Button variant="outline" size="sm" onClick={() => void refetchConnections()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!connectionsLoading && !connectionsError && connections?.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.no_connections')}</p>
      ) : null}
      {connections?.map((connection) => (
        <div key={connection.id} className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium wrap-anywhere">{connection.applicationName || connection.appId}</p>
          <p className="text-muted-foreground text-xs wrap-anywhere">
            {t('knowledge.external.wizard.authorized_account', {
              name: connection.displayName || t('knowledge.external.sources.account_unknown')
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {t('knowledge.external.sources.connection_count', { count: connection.sourceCount })} ·{' '}
            {connection.authorizationStatus === 'connected'
              ? t('knowledge.external.sources.connection_connected')
              : connection.authorizationStatus === 'reauthorization-required'
                ? t('knowledge.external.sources.connection_reauthorization_required')
                : t('knowledge.external.sources.connection_pending_authorization')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
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
            <p className="text-muted-foreground mt-1 text-xs">{t('knowledge.external.sources.connection_in_use')}</p>
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
        title={
          <span className="wrap-anywhere">
            {selected?.name ??
              t(connectionsOpen ? 'knowledge.external.sources.connections' : 'knowledge.external.sources.title')}
          </span>
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
          ) : connectionsOpen ? (
            <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setNewConnectionOpen(true)}>
              <Plus className="size-3.5" />
              {t('knowledge.external.wizard.connect_application')}
            </Button>
          ) : undefined
        }>
        {selected || connectionsOpen ? (
          <Button
            ref={backButtonRef}
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void goBack()}>
            <ArrowLeft className="size-3.5" />
            {t('common.back')}
          </Button>
        ) : null}
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
