import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, IndicatorLight, Switch } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingSubtitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import type {
  PrometheusCheckResult,
  PrometheusCheckStatus,
  PrometheusDoctorReport,
  PrometheusPushState
} from '@shared/types/prometheus'

const ROUTE = '/settings/prometheus'
const domId = (anchorId: string) => getSettingDomId(ROUTE, anchorId)

/**
 * Status is icon + text, never colour alone — `DESIGN.md` requires every state to stay
 * perceivable without relying on colour.
 */
const STATUS_ICON: Record<PrometheusCheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  skip: CircleSlash
}

const STATUS_CLASS: Record<PrometheusCheckStatus, string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-error',
  skip: 'text-foreground-tertiary'
}

/** One diagnostic row. A repair button appears only where the check actually offers one. */
function CheckRow({
  check,
  onRepair,
  repairing
}: {
  check: PrometheusCheckResult
  onRepair: (fixId: string) => void
  repairing: string | null
}) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[check.status]

  return (
    <div className="py-2">
      <SettingRow>
        <SettingRowTitle className="gap-2">
          <Icon size={15} className={STATUS_CLASS[check.status]} aria-hidden="true" />
          <span className="font-medium">{check.title}</span>
          <span className="sr-only">{t(`settings.prometheus.check.${check.status}`)}</span>
        </SettingRowTitle>
        {check.fixId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={repairing !== null}
            onClick={() => onRepair(check.fixId as string)}>
            {repairing === check.fixId
              ? t('settings.prometheus.doctor.repairing')
              : t('settings.prometheus.doctor.repair')}
          </Button>
        ) : null}
      </SettingRow>
      {check.summary ? <SettingHelpText className="mt-1">{check.summary}</SettingHelpText> : null}
      {/* The pack's `detail` is where it explains what to do, so a failure without a repair is
          still actionable. Shown rather than hidden behind a disclosure. */}
      {check.detail && check.status !== 'pass' ? (
        <SettingHelpText className="mt-1 whitespace-pre-wrap text-foreground-tertiary">{check.detail}</SettingHelpText>
      ) : null}
    </div>
  )
}

export default function PrometheusSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [pushEnabled, setPushEnabled] = usePreference('app.prometheus.home_push.enabled')

  const [report, setReport] = useState<PrometheusDoctorReport | null>(null)
  const [running, setRunning] = useState(false)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  const [push, setPush] = useState<PrometheusPushState>({ status: 'idle' })

  useEffect(() => {
    void (async () => {
      try {
        setPush(await ipcApi.request('prometheus.skills.push_state', {}))
      } catch {
        // A push state we cannot read is not worth an error surface; the row shows "not yet
        // installed" and the button still works.
      }
    })()
  }, [])

  const runDoctor = useCallback(async () => {
    setRunning(true)
    setRepairMessage(null)
    try {
      setReport(await ipcApi.request('prometheus.doctor.run', {}))
    } finally {
      setRunning(false)
    }
  }, [])

  const repair = useCallback(
    async (fixId: string) => {
      setRepairing(fixId)
      setRepairMessage(null)
      try {
        const outcome = await ipcApi.request('prometheus.doctor.fix', { fixId })
        // A refusal is a decision the pack made, not a failure — it is reported in its own
        // words rather than being swallowed or restyled as an error.
        if (outcome.status === 'refused') {
          setRepairMessage(t('settings.prometheus.doctor.repairRefused', { reason: outcome.message }))
        } else if (outcome.status === 'failed') {
          setRepairMessage(t('settings.prometheus.doctor.repairFailed', { reason: outcome.message }))
        } else if (outcome.status === 'requires_relaunch') {
          setRepairMessage(t('settings.prometheus.doctor.relaunchNeeded'))
        } else {
          setRepairMessage(t('settings.prometheus.doctor.repairDone'))
        }
        await runDoctor()
      } finally {
        setRepairing(null)
      }
    },
    [runDoctor, t]
  )

  const runPush = useCallback(async () => {
    setPush({ status: 'running' })
    setPush(await ipcApi.request('prometheus.skills.push', {}))
  }, [])

  const failures = report?.results.filter((r) => r.status === 'fail').length ?? 0
  const warnings = report?.results.filter((r) => r.status === 'warn').length ?? 0

  const statusLine = (() => {
    if (report === null) return t('settings.prometheus.status.unknown')
    if (report.available === false) return t('settings.prometheus.status.unavailable')
    if (failures > 0) return t('settings.prometheus.status.failures', { count: failures })
    if (warnings > 0) return t('settings.prometheus.status.warnings', { count: warnings })
    return t('settings.prometheus.status.healthy')
  })()

  const statusColor =
    report === null || report.available === false
      ? 'var(--foreground-tertiary)'
      : failures > 0
        ? 'var(--error)'
        : warnings > 0
          ? 'var(--warning)'
          : 'var(--success)'

  const refused = push.status === 'refused'

  return (
    <SettingsContentColumn theme={theme}>
      {/* 1 · Status — one line, no interaction, answers the only question most visits have. */}
      <SettingGroup theme={theme} id={domId('status')} className="scroll-mt-6">
        <SettingTitle>{t('settings.prometheus.title')}</SettingTitle>
        <SettingDescription>{t('settings.prometheus.description')}</SettingDescription>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle className="gap-2">
            <IndicatorLight color={statusColor} />
            <span>{statusLine}</span>
          </SettingRowTitle>
        </SettingRow>
      </SettingGroup>

      {/* 2 · Skill availability — the one surface that writes into $HOME. */}
      <SettingGroup theme={theme} id={domId('skill-push')} className="scroll-mt-6">
        <SettingSubtitle>
          {refused ? t('settings.prometheus.push.fullPackTitle') : t('settings.prometheus.push.title')}
        </SettingSubtitle>
        <SettingDescription>
          {refused ? t('settings.prometheus.push.fullPackDescription') : t('settings.prometheus.push.description')}
        </SettingDescription>
        <SettingDivider />

        {refused ? (
          // Disabled WITH the reason, and the markers that caused it, so the refusal is
          // auditable rather than mysterious. No control is offered to override it (A-3).
          <SettingHelpText className="whitespace-pre-wrap opacity-70">
            {t('settings.prometheus.push.fullPackMarkers', { markers: (push.markers ?? []).join('\n') })}
          </SettingHelpText>
        ) : (
          <>
            <SettingRow>
              <SettingRowTitle>{t('settings.prometheus.push.enabled')}</SettingRowTitle>
              <Switch checked={pushEnabled} onCheckedChange={setPushEnabled} />
            </SettingRow>
            <SettingRow className="mt-3">
              <SettingRowTitle className="gap-2" role="status" aria-atomic="true">
                {push.status === 'running' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                <span>
                  {push.status === 'running'
                    ? t('settings.prometheus.push.running')
                    : push.status === 'done'
                      ? t('settings.prometheus.push.upToDate', { count: push.count ?? 0 })
                      : push.status === 'failed'
                        ? t('settings.prometheus.push.failed')
                        : t('settings.prometheus.push.never')}
                </span>
              </SettingRowTitle>
              <Button size="sm" variant="outline" disabled={push.status === 'running'} onClick={() => void runPush()}>
                {t('settings.prometheus.push.action')}
              </Button>
            </SettingRow>
          </>
        )}
      </SettingGroup>

      {/* 3 · Diagnostics — detail is earned by running, not shown by default. */}
      <SettingGroup theme={theme} id={domId('doctor-run')} className="scroll-mt-6">
        <SettingSubtitle>{t('settings.prometheus.doctor.title')}</SettingSubtitle>
        <SettingDescription>{t('settings.prometheus.doctor.description')}</SettingDescription>
        <SettingDivider />

        <SettingRow>
          <SettingRowTitle className="gap-2" role="status" aria-atomic="true">
            {running ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            <span>{running ? t('settings.prometheus.doctor.running') : statusLine}</span>
          </SettingRowTitle>
          <Button size="sm" variant="outline" disabled={running} onClick={() => void runDoctor()}>
            {t('settings.prometheus.doctor.run')}
          </Button>
        </SettingRow>

        {repairMessage ? (
          <SettingHelpText className="mt-2" role="alert">
            {repairMessage}
          </SettingHelpText>
        ) : null}

        {report?.available === false ? (
          <SettingHelpText className="mt-2">{t('settings.prometheus.doctor.unavailable')}</SettingHelpText>
        ) : null}

        {report && report.available !== false && !report.complete ? (
          <SettingHelpText className="mt-2 text-warning">{t('settings.prometheus.doctor.incomplete')}</SettingHelpText>
        ) : null}

        {report && report.results.length > 0 ? (
          <div className="mt-2">
            {report.results.map((check) => (
              <CheckRow key={check.id} check={check} onRepair={(id) => void repair(id)} repairing={repairing} />
            ))}
          </div>
        ) : null}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
