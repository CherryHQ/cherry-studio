import { AlertTriangle, RefreshCw, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { UarApprovalLifecycleInspection, UarOperationalSnapshot } from '@shared/types/prometheusIntegration'

const activeStates = new Set<UarApprovalLifecycleInspection['state']>([
  'prepared',
  'awaiting-human',
  'awaiting-ack',
  'authorized',
  'claimed'
])
const uncertainStates = new Set<UarApprovalLifecycleInspection['state']>(['interrupted', 'outcome-unknown'])

export function UarApprovalLifecyclePanel() {
  const { t, i18n } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.approvals.${key}`, options)
  const [snapshot, setSnapshot] = useState<UarOperationalSnapshot>()
  const [owner, setOwner] = useState('all')
  const [busyRun, setBusyRun] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.operations.read', {}))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const ownerNames = useMemo(
    () => new Map(snapshot?.owners.map((item) => [item.sessionId, `${item.agentName} · ${item.sessionName}`])),
    [snapshot]
  )
  const approvals = useMemo(
    () => snapshot?.approvals.filter((item) => owner === 'all' || item.ownerSessionId === owner) ?? [],
    [owner, snapshot]
  )
  const pending = approvals.filter((item) => activeStates.has(item.state))
  const uncertain = approvals.filter((item) => uncertainStates.has(item.state))
  const results = approvals.filter((item) => !activeStates.has(item.state) && !uncertainStates.has(item.state))

  const cancel = async (item: UarApprovalLifecycleInspection) => {
    setBusyRun(item.rootRunId)
    setError(undefined)
    try {
      await ipcApi.request('prometheus.uar.runs.cancel', { runId: item.rootRunId })
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    } finally {
      setBusyRun(undefined)
    }
  }

  if (!snapshot) {
    return (
      <SettingGroup>
        <SettingTitle>{tr('title')}</SettingTitle>
        {error && (
          <p className="mt-3 text-sm text-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="outline" size="sm" className="mt-4" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </SettingGroup>
    )
  }

  return (
    <SettingGroup>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SettingTitle>{tr('title')}</SettingTitle>
          <SettingDescription>{tr('description')}</SettingDescription>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </div>

      <Select value={owner} onValueChange={setOwner}>
        <SelectTrigger className="mt-4" aria-label={tr('owner')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{tr('allOwners')}</SelectItem>
          {snapshot.owners.map((item) => (
            <SelectItem key={item.sessionId} value={item.sessionId}>
              {item.agentName} · {item.sessionName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <div className="mt-4 rounded-lg border border-error-border bg-error-subtle px-3 py-2 text-sm text-error-subtle-foreground" role="alert">
          {error}
        </div>
      )}
      {approvals.length === 0 && <p className="mt-5 text-sm text-muted-foreground">{tr('empty')}</p>}

      <ApprovalSection title={tr('pending')} items={pending} ownerNames={ownerNames} locale={i18n.language}>
        {(item) =>
          item.state === 'claimed' ? (
            <span className="text-xs text-muted-foreground">{tr('claimedNotice')}</span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busyRun === item.rootRunId}
              onClick={() => void cancel(item)}>
              <Square size={13} aria-hidden="true" />
              {tr('cancelRun')}
            </Button>
          )
        }
      </ApprovalSection>

      {uncertain.length > 0 && (
        <div className="mt-5 rounded-lg border border-warning-border bg-warning-subtle p-3">
          <div className="flex items-center gap-2 font-medium text-warning-subtle-foreground">
            <AlertTriangle size={16} aria-hidden="true" />
            {tr('interrupted')}
          </div>
          <p className="mt-1 text-sm text-warning-subtle-foreground">{tr('interruptedAction')}</p>
          <ApprovalSection items={uncertain} ownerNames={ownerNames} locale={i18n.language} />
        </div>
      )}

      <ApprovalSection title={tr('results')} items={results} ownerNames={ownerNames} locale={i18n.language} />
    </SettingGroup>
  )
}

function ApprovalSection({
  title,
  items,
  ownerNames,
  locale,
  children
}: {
  title?: string
  items: UarApprovalLifecycleInspection[]
  ownerNames: ReadonlyMap<string, string>
  locale: string
  children?: (item: UarApprovalLifecycleInspection) => ReactNode
}) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="mt-5 space-y-2">
      {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
      {items.map((item) => (
        <div key={item.admissionId} className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{item.action.operation ?? item.toolName}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {ownerNames.get(item.ownerSessionId) ?? item.ownerSessionId}
              </div>
              {item.action.target && <div className="mt-1 break-all font-mono text-xs">{item.action.target}</div>}
              {item.action.riskReason && (
                <div className="mt-1 text-xs text-muted-foreground">{item.action.riskReason}</div>
              )}
            </div>
            <Badge variant="outline">
              {t(`settings.prometheus.integration.uarAdmin.approvals.state.${item.state}`)}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(item.updatedAt)}</span>
            {children?.(item)}
          </div>
        </div>
      ))}
    </section>
  )
}
