import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSharedCacheValue } from '@data/hooks/useCache'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { toastAppError } from '@renderer/services/AppErrorDetailService'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { HermesDashboardStartFailureReason } from '@shared/ipc/schemas/hermesDashboard'
import { CodeCli } from '@shared/types/codeCli'

const logger = loggerService.withContext('useHermesDashboardController')
const ERROR_DETAIL_LIMIT = 200

const START_ERROR_KEYS: Record<HermesDashboardStartFailureReason, string> = {
  cancelled: 'code.hermes_dashboard.error.cancelled',
  dashboard_dependencies_missing: 'code.hermes_dashboard.error.dependencies_missing',
  not_installed: 'code.hermes_dashboard.error.not_installed',
  startup_failed: 'code.hermes_dashboard.error.startup_failed'
}

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
  const snapshot = useSharedCacheValue('feature.hermes_dashboard.status') ?? { status: 'stopped' as const }
  const previousStatus = useRef(snapshot.status)
  const operationEpoch = useRef(0)
  const [pendingOperation, setPendingOperation] = useState<'launch' | 'stop' | null>(null)
  const isHermes = selectedCliTool === CodeCli.HERMES

  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = snapshot.status
    if (
      (previous === 'running' && (snapshot.status === 'stopped' || snapshot.status === 'error')) ||
      (previous === 'starting' && snapshot.status === 'error')
    ) {
      onConfigMayHaveChanged?.()
    }
  }, [onConfigMayHaveChanged, snapshot.status])

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
    const epoch = ++operationEpoch.current
    setPendingOperation('launch')
    try {
      const result = await ipcApi.request('hermes_dashboard.start')
      if (epoch !== operationEpoch.current) return
      if (!result.success) {
        previousStatus.current = 'error'
        onConfigMayHaveChanged?.()
        logger.error('Failed to launch Hermes Dashboard', new Error(result.message), { reason: result.reason })
        const detail = result.message.trim()
        toast.error({
          title: withDetail(t(START_ERROR_KEYS[result.reason]), detail),
          cause: detail ? { message: detail } : undefined,
          data: { source: 'code.hermes', operation: 'hermes_dashboard.start', params: { reason: result.reason } }
        })
        return
      }
      openDashboard(result.url)
    } catch (error) {
      logger.error('Failed to launch Hermes Dashboard', error as Error)
      toastAppError(t(START_ERROR_KEYS.startup_failed), error, {
        source: 'code.hermes',
        operation: 'hermes_dashboard.start'
      })
    } finally {
      if (epoch === operationEpoch.current) setPendingOperation(null)
    }
  }, [onConfigMayHaveChanged, openDashboard, t])

  const onStop = useCallback(async () => {
    const epoch = ++operationEpoch.current
    setPendingOperation('stop')
    try {
      const result = await ipcApi.request('hermes_dashboard.stop')
      if (epoch !== operationEpoch.current) return false
      if (!result.success) {
        logger.error('Failed to stop Hermes Dashboard', new Error(result.message))
        const detail = result.message.trim()
        toast.error({
          title: withDetail(t('code.hermes_dashboard.error.stop_failed'), detail),
          cause: detail ? { message: detail } : undefined,
          data: { source: 'code.hermes', operation: 'hermes_dashboard.stop' }
        })
        return false
      }
      previousStatus.current = 'stopped'
      onConfigMayHaveChanged?.()
      return true
    } catch (error) {
      logger.error('Failed to stop Hermes Dashboard', error as Error)
      toastAppError(t('code.hermes_dashboard.error.stop_failed'), error, {
        source: 'code.hermes',
        operation: 'hermes_dashboard.stop'
      })
      return false
    } finally {
      if (epoch === operationEpoch.current) setPendingOperation(null)
    }
  }, [onConfigMayHaveChanged, t])

  const onOpenDashboard = useCallback(async () => {
    if (snapshot.status === 'running' && snapshot.url) {
      openDashboard(snapshot.url)
      return
    }
    logger.error('Failed to open Hermes Dashboard', new Error('Hermes Dashboard is not running'))
    toastAppError(t('code.hermes_dashboard.error.open_failed'), 'Hermes Dashboard is not running', {
      source: 'code.hermes',
      operation: 'hermes_dashboard.open_dashboard',
      params: { status: snapshot.status }
    })
  }, [openDashboard, snapshot.status, snapshot.url, t])

  return {
    launching: isHermes && pendingOperation === 'launch',
    running: isHermes && snapshot.status === 'running',
    starting: isHermes && snapshot.status === 'starting',
    stopping: isHermes && pendingOperation === 'stop',
    onLaunch,
    onOpenDashboard,
    onStop
  }
}
