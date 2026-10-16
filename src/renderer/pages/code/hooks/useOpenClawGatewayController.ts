import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'

import { resolveLaunchModelId } from '../cliConfig'
import { useManagedToolStatus } from './useManagedToolStatus'

const logger = loggerService.withContext('useOpenClawGatewayController')

interface UseOpenClawGatewayControllerOptions {
  selectedCliTool: CodeCli
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
}

interface OpenClawGatewayController {
  launching: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  onLaunch: () => Promise<void>
  onStop: () => Promise<void>
  onOpenDashboard: () => Promise<void>
}

export function useOpenClawGatewayController({
  selectedCliTool,
  enabledProvider,
  currentProviderConfig,
  upsertProviderConfig,
  setCurrentProvider
}: UseOpenClawGatewayControllerOptions): OpenClawGatewayController {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const [gatewayPort] = usePreference('feature.openclaw.gateway_port')
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW
  // Status comes from main-pushed events (single source of truth); only the local
  // launching/stopping intents live here, covering the gap until events arrive.
  const { status } = useManagedToolStatus('openclaw', isOpenClawTool)
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)

  const openDashboard = useCallback(async () => {
    const dashboardUrl = await ipcApi.request('openclaw.get_dashboard_url')
    const url = new URL(dashboardUrl)
    // A per-open revision makes equal dashboard URLs observable through the
    // cross-window transient descriptor registry after a gateway restart.
    url.searchParams.set('cherry_navigation_revision', String(Date.now()))
    openSmartMiniApp({
      appId: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: url.toString(),
      logo: 'openclaw'
    })
  }, [openSmartMiniApp])

  const handleLaunch = useCallback(async () => {
    const parsedModelId = await resolveLaunchModelId({
      enabledProvider,
      currentProviderConfig,
      upsertProviderConfig,
      setCurrentProvider,
      errorToastKey: 'openclaw.error.select_provider_model',
      logLabel: 'Invalid OpenClaw model id configured'
    })
    if (!parsedModelId) return

    try {
      setLaunching(true)
      const syncResult = await ipcApi.request('openclaw.sync_config', {
        uniqueModelId: parsedModelId.uniqueModelId,
        port: gatewayPort
      })
      if (!syncResult.success) {
        toast.error(syncResult.message)
        return
      }

      const startResult = await ipcApi.request('openclaw.start_gateway', { port: gatewayPort })
      if (!startResult.success) {
        toast.error(startResult.message)
        return
      }

      await openDashboard()
    } catch (err) {
      logger.error('Failed to launch OpenClaw dashboard:', err as Error)
      toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [currentProviderConfig, enabledProvider, gatewayPort, openDashboard, setCurrentProvider, upsertProviderConfig, t])

  const handleStop = useCallback(async () => {
    try {
      setStopping(true)
      const result = await ipcApi.request('openclaw.stop_gateway')
      if (!result.success) {
        toast.error(result.message)
        return
      }
    } catch (err) {
      logger.error('Failed to stop OpenClaw gateway:', err as Error)
      toast.error(t('code.launch.error'))
    } finally {
      setStopping(false)
    }
  }, [t])

  const handleOpenDashboard = useCallback(async () => {
    try {
      await openDashboard()
    } catch (err) {
      logger.error('Failed to open OpenClaw dashboard:', err as Error)
      toast.error(t('code.launch.error'))
    }
  }, [openDashboard, t])

  return {
    launching,
    running: isOpenClawTool && status === 'running',
    starting: isOpenClawTool && status === 'starting',
    stopping,
    onLaunch: handleLaunch,
    onStop: handleStop,
    onOpenDashboard: handleOpenDashboard
  }
}
