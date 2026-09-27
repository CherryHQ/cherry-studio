import { Link2Off, RefreshCw, Settings2 } from 'lucide-react'
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

const ExternalSourcesSection = ({ baseId }: { baseId: string }) => {
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
  const [disconnectId, setDisconnectId] = useState<string | null>(null)
  const [disconnectMode, setDisconnectMode] = useState<'keep-local' | 'remove-local' | null>(null)
  const [removeConnectionId, setRemoveConnectionId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<'manual' | 'daily'>('manual')
  const [dailyTime, setDailyTime] = useState('09:00')
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

  const isBusy = Boolean(busyId)
  const dailyTimeMissing = policy === 'daily' && !dailyTime
  const selected = sources?.find((source) => source.id === selectedId)
  const disconnecting = sources?.find((source) => source.id === disconnectId)
  const connectionById = new Map(connections?.map((connection) => [connection.id, connection]) ?? [])
  const openSource = (source: ExternalKnowledgeSourceListItem) => {
    if (isBusy) return
    setSelectedId(source.id)
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
  const saveSettings = async () => {
    if (!selected || isBusy || dailyTimeMissing) return
    if (!name.trim()) {
      toast.warning(t('knowledge.external.sources.name_required'))
      return
    }
    setBusyId(selected.id)
    try {
      if (name.trim() !== selected.name) {
        await ipcApi.request('knowledge.external_source.rename', { sourceId: selected.id, name: name.trim() })
      }
      const nextPolicy =
        policy === 'manual'
          ? ({ kind: 'manual' } as const)
          : ({
              kind: 'daily',
              time: dailyTime,
              timezone:
                selected.schedule.policy.kind === 'daily'
                  ? selected.schedule.policy.timezone
                  : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            } as const)
      if (JSON.stringify(nextPolicy) !== JSON.stringify(selected.schedule.policy)) {
        await ipcApi.request('knowledge.external_source.schedule.update', { sourceId: selected.id, policy: nextPolicy })
      }
      void refetch()
      toast.success(t('common.saved'))
    } catch (cause) {
      toast.error(formatErrorMessageWithPrefix(cause, t('knowledge.external.sources.save_error')))
    } finally {
      setBusyId(null)
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
  const reconnect = async (connection: ExternalKnowledgeConnectionListItem) => {
    if (isBusy) return
    setBusyId(connection.id)
    let startedId: string | null = null
    try {
      const started = await ipcApi.request('knowledge.feishu.connection.reconnect', { connectionId: connection.id })
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
        toast.error(formatErrorMessageWithPrefix(cause, t('knowledge.external.sources.reconnect_error')))
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

  return (
    <section aria-label={t('knowledge.external.sources.title')} className="shrink-0 border-b border-border px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('knowledge.external.sources.title')}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setConnectionsOpen(true)}>
            {t('knowledge.external.sources.connections')}
          </Button>
          <NormalTooltip content={t('common.refresh')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('common.refresh')} onClick={refresh}>
              <RefreshCw className="size-3.5" />
            </Button>
          </NormalTooltip>
        </div>
      </div>
      {isLoading ? <p className="text-muted-foreground text-sm">{t('common.loading')}</p> : null}
      {error ? (
        <div className="flex items-center gap-2 text-sm">
          <span>{t('knowledge.external.sources.load_error')}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {!isLoading && !error && sources?.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('knowledge.external.sources.empty')}</p>
      ) : null}
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {sources?.map((source) => {
          const connection = connectionById.get(source.connectionId)
          return (
            <div key={source.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Button
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
                    <p className="text-muted-foreground text-xs">{t('knowledge.external.sources.paused')}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <NormalTooltip content={t('knowledge.external.sources.sync_now')}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('knowledge.external.sources.sync_now')}
                      disabled={isBusy}
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
      <PageSidePanel
        open={Boolean(selected)}
        onClose={() => !isBusy && setSelectedId(null)}
        showCloseButton={!isBusy}
        title={<span className="wrap-anywhere">{selected?.name ?? ''}</span>}
        closeLabel={t('common.close')}>
        {selected ? (
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
                {connectionById.get(selected.connectionId)?.displayName ??
                  t('knowledge.external.sources.account_unknown')}
              </p>
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="font-medium">{t('common.settings')}</h3>
              <Label htmlFor="external-source-name">{t('knowledge.external.wizard.name')}</Label>
              <Input
                id="external-source-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={256}
                disabled={isBusy}
              />
              <div className="space-y-1.5">
                <p className="font-medium">{t('knowledge.external.wizard.sync_frequency')}</p>
                <SegmentedControl<'manual' | 'daily'>
                  aria-label={t('knowledge.external.wizard.sync_frequency')}
                  options={[
                    { value: 'manual', label: t('knowledge.external.wizard.manual') },
                    { value: 'daily', label: t('knowledge.external.wizard.daily') }
                  ]}
                  value={policy}
                  onValueChange={setPolicy}
                  disabled={isBusy}
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
                    disabled={isBusy}
                    aria-invalid={dailyTimeMissing || undefined}
                    aria-describedby={dailyTimeMissing ? 'external-source-time-error' : undefined}
                    value={dailyTime}
                    onChange={(event) => setDailyTime(event.target.value)}
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
              <Button
                size="sm"
                loading={busyId === selected.id}
                disabled={isBusy || !name.trim() || dailyTimeMissing}
                onClick={() => void saveSettings()}>
                {t('common.save')}
              </Button>
            </div>
            <SourceIssues sourceId={selected.id} />
            <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setDisconnectId(selected.id)}>
              {t('knowledge.external.sources.disconnect')}
            </Button>
          </div>
        ) : null}
      </PageSidePanel>
      <PageSidePanel
        open={connectionsOpen}
        onClose={() => !isBusy && setConnectionsOpen(false)}
        showCloseButton={!isBusy}
        title={t('knowledge.external.sources.connections')}
        closeLabel={t('common.close')}>
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
              <p className="font-medium wrap-anywhere">
                {connection.displayName ?? connection.applicationName ?? connection.appId}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('knowledge.external.sources.connection_count', { count: connection.sourceCount })} ·{' '}
                {connection.authorizationStatus === 'connected'
                  ? t('knowledge.external.sources.connection_connected')
                  : connection.authorizationStatus === 'reauthorization-required'
                    ? t('knowledge.external.sources.connection_reauthorization_required')
                    : t('knowledge.external.sources.connection_pending_authorization')}
              </p>
              <div className="mt-2 flex gap-2">
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
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('knowledge.external.sources.connection_in_use')}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </PageSidePanel>
      <Dialog open={Boolean(disconnecting)} onOpenChange={(open) => !open && !isBusy && setDisconnectId(null)}>
        <DialogContent showCloseButton={!isBusy} closeOnOverlayClick={!isBusy} closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('knowledge.external.sources.disconnect_title')}</DialogTitle>
            <DialogDescription>{t('knowledge.external.sources.disconnect_description')}</DialogDescription>
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
        description={t('knowledge.external.sources.remove_connection_description')}
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
        open={Boolean(authSession)}
        onOpenChange={(open) => {
          if (!open && authSessionId.current) {
            void ipcApi.request('knowledge.feishu.authorization.cancel', {
              authorizationSessionId: authSessionId.current
            })
            authSessionId.current = null
            setAuthSession(null)
          }
        }}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('knowledge.external.sources.reconnect')}</DialogTitle>
            <DialogDescription>{t('knowledge.external.wizard.authorization_help')}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">{t('knowledge.external.wizard.verification_code', { code: authSession?.code })}</p>
          <Button variant="outline" onClick={() => authSession && void window.api.shell.openExternal(authSession.uri)}>
            {t('knowledge.external.wizard.open_feishu')}
          </Button>
          <p role="status" className="text-muted-foreground text-sm">
            {t('knowledge.external.wizard.authorizing')}
          </p>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default ExternalSourcesSection
