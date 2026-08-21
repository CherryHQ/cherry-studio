import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useHermesDashboardController')

interface HermesDashboardController {
  launching: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  onLaunch: () => Promise<void>
  onOpenDashboard: () => Promise<void>
  onStop: () => Promise<boolean>
}

export function useHermesDashboardController(selectedCliTool: CodeCli): HermesDashboardController {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const [status, setStatus] = useState<HermesDashboardStatus>('stopped')
  const [url, setUrl] = useState<string>()
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const isHermes = selectedCliTool === CodeCli.HERMES

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
    try {
      setLaunching(true)
      setStatus('starting')
      const result = await ipcApi.request('hermes_dashboard.start')
      if (!result.success) {
        setStatus('error')
        toast.error(result.message)
        return
      }
      setStatus('running')
      setUrl(result.url)
      openDashboard(result.url)
    } catch (error) {
      setStatus('error')
      logger.error('Failed to launch Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [openDashboard, t])

  const onStop = useCallback(async () => {
    try {
      setStopping(true)
      const result = await ipcApi.request('hermes_dashboard.stop')
      if (!result.success) {
        toast.error(result.message)
        return false
      }
      setStatus('stopped')
      setUrl(undefined)
      return true
    } catch (error) {
      logger.error('Failed to stop Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
      return false
    } finally {
      setStopping(false)
    }
  }, [t])

  const onOpenDashboard = useCallback(async () => {
    try {
      if (url) {
        openDashboard(url)
        return
      }
      const current = await ipcApi.request('hermes_dashboard.get_status')
      if (current.status !== 'running' || !current.url) throw new Error('Hermes Dashboard is not running')
      setStatus('running')
      setUrl(current.url)
      openDashboard(current.url)
    } catch (error) {
      logger.error('Failed to open Hermes Dashboard', error as Error)
      toast.error(t('code.launch.error'))
    }
  }, [openDashboard, t, url])

  useEffect(() => {
    if (!isHermes) return
    let cancelled = false
    const refreshStatus = async () => {
      try {
        const current = await ipcApi.request('hermes_dashboard.get_status')
        if (!cancelled) {
          setStatus(current.status)
          setUrl(current.url)
        }
      } catch (error) {
        logger.error('Failed to read Hermes Dashboard status', error as Error)
      }
    }

    void refreshStatus()
    const interval = window.setInterval(refreshStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isHermes])

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
