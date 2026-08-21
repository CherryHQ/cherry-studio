import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useHermesDashboardController')

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
  const [url, setUrl] = useState<string>()
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const statusRef = useRef(status)
  const statusEpochRef = useRef(0)
  const operationInFlightRef = useRef(false)
  const isHermes = selectedCliTool === CodeCli.HERMES

  const applyStatus = useCallback(
    (nextStatus: HermesDashboardStatus, nextUrl?: string, reloadConfig = false) => {
      statusRef.current = nextStatus
      setStatus(nextStatus)
      setUrl(nextUrl)
      if (reloadConfig) onConfigMayHaveChanged?.()
    },
    [onConfigMayHaveChanged]
  )

  const openDashboard = useCallback(
    (dashboardUrl: string) => {
      const target = new URL(dashboardUrl)
      target.searchParams.set('cherry_navigation_revision', String(Date.now()))
      openSmartMiniApp({
        appId: 'hermes-dashboard',
        name: 'Hermes',
        url: target.toString(),
        logo: 'nousresearch'
      })
    },
    [openSmartMiniApp]
  )

  const onLaunch = useCallback(async () => {
    const operationEpoch = ++statusEpochRef.current
    operationInFlightRef.current = true
    try {
      setLaunching(true)
      applyStatus('starting')
      const result = await ipcApi.request('hermes_dashboard.start')
      if (operationEpoch !== statusEpochRef.current) return
      if (!result.success) {
        applyStatus('error', undefined, true)
        toast.error(result.message)
        return
      }
      applyStatus('running', result.url)
      openDashboard(result.url)
    } catch (error) {
      if (operationEpoch !== statusEpochRef.current) return
      applyStatus('error', undefined, true)
      logger.error('Failed to launch Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
    } finally {
      if (operationEpoch === statusEpochRef.current) operationInFlightRef.current = false
      setLaunching(false)
    }
  }, [applyStatus, openDashboard, t])

  const onStop = useCallback(async () => {
    const operationEpoch = ++statusEpochRef.current
    operationInFlightRef.current = true
    try {
      setStopping(true)
      const result = await ipcApi.request('hermes_dashboard.stop')
      if (operationEpoch !== statusEpochRef.current) return false
      if (!result.success) {
        toast.error(result.message)
        return false
      }
      applyStatus('stopped', undefined, true)
      return true
    } catch (error) {
      if (operationEpoch !== statusEpochRef.current) return false
      logger.error('Failed to stop Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
      return false
    } finally {
      if (operationEpoch === statusEpochRef.current) operationInFlightRef.current = false
      setStopping(false)
    }
  }, [applyStatus, t])

  const onOpenDashboard = useCallback(async () => {
    try {
      if (url) {
        openDashboard(url)
        return
      }
      const current = await ipcApi.request('hermes_dashboard.get_status')
      if (current.status !== 'running' || !current.url) throw new Error('Hermes Dashboard is not running')
      applyStatus('running', current.url)
      openDashboard(current.url)
    } catch (error) {
      logger.error('Failed to open Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
    }
  }, [applyStatus, openDashboard, t, url])

  useEffect(() => {
    if (!isHermes) return
    let cancelled = false
    const refreshStatus = async () => {
      if (operationInFlightRef.current) return
      const requestEpoch = statusEpochRef.current
      try {
        const current = await ipcApi.request('hermes_dashboard.get_status')
        if (cancelled || requestEpoch !== statusEpochRef.current || operationInFlightRef.current) return
        const previousStatus = statusRef.current
        const shouldReload =
          (previousStatus === 'running' && (current.status === 'stopped' || current.status === 'error')) ||
          (previousStatus === 'starting' && current.status === 'error')
        applyStatus(current.status, current.url, shouldReload)
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
  }, [applyStatus, isHermes])

  return {
    launching: isHermes && launching,
    running: isHermes && status === 'running',
    starting: isHermes && status === 'starting',
    stopping: isHermes && stopping,
    onLaunch,
    onOpenDashboard,
    onStop
  }
}
