import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { HermesDashboardStartFailureReason, HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useHermesDashboardController')

const ERROR_DETAIL_LIMIT = 200

const START_ERROR_KEYS: Record<HermesDashboardStartFailureReason, string> = {
  cancelled: 'code.hermes_dashboard.error.cancelled',
  dashboard_dependencies_missing: 'code.hermes_dashboard.error.dependencies_missing',
  not_installed: 'code.hermes_dashboard.error.not_installed',
  startup_failed: 'code.hermes_dashboard.error.startup_failed'
}

/** Keeps the localized reason while still surfacing the main-process diagnostic, which is redacted at its source. */
function withDetail(title: string, detail: string | undefined): string {
  const trimmed = detail?.trim()
  return trimmed ? `${title}: ${trimmed.slice(0, ERROR_DETAIL_LIMIT)}` : title
}

interface HermesDashboardControllerOptions {
  onConfigMayHaveChanged?: () => void
}

interface HermesDashboardController {
  launching: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  onLaunch: () => Promise<void>
  onOpenDashboard: () => Promise<void>
  onStop: () => Promise<boolean>
}

export function useHermesDashboardController(
  selectedCliTool: CodeCli,
  { onConfigMayHaveChanged }: HermesDashboardControllerOptions = {}
): HermesDashboardController {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const [status, setStatus] = useState<HermesDashboardStatus>('stopped')
  const [pendingOperation, setPendingOperation] = useState<'launch' | 'stop' | null>(null)
  const statusRef = useRef(status)
  const statusEpochRef = useRef(0)
  const statusRevisionRef = useRef(0)
  const operationInFlightRef = useRef(false)
  const isHermes = selectedCliTool === CodeCli.HERMES

  const applyStatus = useCallback(
    (nextStatus: HermesDashboardStatus, reloadConfig = false) => {
      statusRef.current = nextStatus
      statusRevisionRef.current += 1
      setStatus(nextStatus)
      if (reloadConfig) onConfigMayHaveChanged?.()
    },
    [onConfigMayHaveChanged]
  )

  /** Applies a status that main reported (poll or cross-window push), reloading config when the run ended. */
  const applyRemoteStatus = useCallback(
    (next: HermesDashboardStatus) => {
      const previous = statusRef.current
      const shouldReload =
        (previous === 'running' && (next === 'stopped' || next === 'error')) ||
        (previous === 'starting' && next === 'error')
      applyStatus(next, shouldReload)
    },
    [applyStatus]
  )

  const openDashboard = useCallback(
    (dashboardUrl: string) => {
      const target = new URL(dashboardUrl)
      target.searchParams.set('cherry_navigation_revision', String(Date.now()))
      openSmartMiniApp({
        appId: 'hermes-dashboard',
        name: t('code.cli_tools.hermes'),
        url: target.toString(),
        logo: 'nousresearch'
      })
    },
    [openSmartMiniApp, t]
  )

  const onLaunch = useCallback(async () => {
    const operationEpoch = ++statusEpochRef.current
    operationInFlightRef.current = true
    setPendingOperation('launch')
    try {
      applyStatus('starting')
      const result = await ipcApi.request('hermes_dashboard.start')
      if (operationEpoch !== statusEpochRef.current) return
      if (!result.success) {
        applyStatus('error', true)
        logger.error('Failed to launch Hermes Dashboard', new Error(result.message), { reason: result.reason })
        toast.error(withDetail(t(START_ERROR_KEYS[result.reason]), result.message))
        return
      }
      applyStatus('running')
      openDashboard(result.url)
    } catch (error) {
      if (operationEpoch !== statusEpochRef.current) return
      applyStatus('error', true)
      logger.error('Failed to launch Hermes Dashboard', error as Error)
      toast.error(t(START_ERROR_KEYS.startup_failed))
    } finally {
      if (operationEpoch === statusEpochRef.current) {
        operationInFlightRef.current = false
        setPendingOperation(null)
      }
    }
  }, [applyStatus, openDashboard, t])

  const onStop = useCallback(async () => {
    const operationEpoch = ++statusEpochRef.current
    operationInFlightRef.current = true
    setPendingOperation('stop')
    try {
      const result = await ipcApi.request('hermes_dashboard.stop')
      if (operationEpoch !== statusEpochRef.current) return false
      if (!result.success) {
        logger.error('Failed to stop Hermes Dashboard', new Error(result.message))
        toast.error(withDetail(t('code.hermes_dashboard.error.stop_failed'), result.message))
        return false
      }
      applyStatus('stopped', true)
      return true
    } catch (error) {
      if (operationEpoch !== statusEpochRef.current) return false
      logger.error('Failed to stop Hermes Dashboard', error as Error)
      toast.error(t('code.hermes_dashboard.error.stop_failed'))
      return false
    } finally {
      if (operationEpoch === statusEpochRef.current) {
        operationInFlightRef.current = false
        setPendingOperation(null)
      }
    }
  }, [applyStatus, t])

  const onOpenDashboard = useCallback(async () => {
    const operationEpoch = statusEpochRef.current
    try {
      const current = await ipcApi.request('hermes_dashboard.get_status')
      // A launch/stop started or finished while this read was in flight — its
      // outcome supersedes this stale snapshot, so don't revive 'running' or open.
      if (operationEpoch !== statusEpochRef.current || operationInFlightRef.current) return
      if (current.status !== 'running' || !current.url) throw new Error('Hermes Dashboard is not running')
      applyStatus('running')
      openDashboard(current.url)
    } catch (error) {
      if (operationEpoch !== statusEpochRef.current) return
      logger.error('Failed to open Hermes Dashboard', error as Error)
      toast.error(t('code.hermes_dashboard.error.open_failed'))
    }
  }, [applyStatus, openDashboard, t])

  useEffect(() => {
    if (!isHermes) return
    let cancelled = false
    const refreshStatus = async () => {
      if (operationInFlightRef.current) return
      const requestEpoch = statusEpochRef.current
      const requestRevision = statusRevisionRef.current
      try {
        const current = await ipcApi.request('hermes_dashboard.get_status')
        // A cross-window push applied while this poll was in flight already carries
        // a newer truth than the answer being handled here.
        if (cancelled || requestRevision !== statusRevisionRef.current) return
        // Not redundant with the revision check: a failed stop applies no status at
        // all, so only its epoch marks this answer as predating the attempt.
        if (requestEpoch !== statusEpochRef.current || operationInFlightRef.current) return
        applyRemoteStatus(current.status)
      } catch (error) {
        if (!cancelled) logger.error('Failed to read Hermes Dashboard status', error as Error)
      }
    }

    void refreshStatus()
    const interval = window.setInterval(refreshStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [applyRemoteStatus, isHermes])

  useIpcOn('hermes_dashboard.status_changed', (current) => {
    if (isHermes) applyRemoteStatus(current.status)
  })

  return {
    launching: isHermes && pendingOperation === 'launch',
    running: isHermes && status === 'running',
    starting: isHermes && status === 'starting',
    stopping: isHermes && pendingOperation === 'stop',
    onLaunch,
    onOpenDashboard,
    onStop
  }
}
