import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseConfiguredModelId } from '../cliConfig/applyContext'

const logger = loggerService.withContext('useOpenClawGatewayController')

type OpenClawGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

interface UseOpenClawGatewayControllerOptions {
  selectedCliTool: CodeCli
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  upsertProviderConfig: (
    providerId: string,
    partial: { modelId: string } & Partial<CliProviderConfig>
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
  const [status, setStatus] = useState<OpenClawGatewayStatus>('stopped')
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const isOpenClawTool = selectedCliTool === CodeCli.OPENCLAW

  const handleLaunch = useCallback(async () => {
    if (!enabledProvider || !currentProviderConfig?.modelId) {
      window.toast.error(t('openclaw.error.select_provider_model'))
      return
    }

    const parsedModelId = parseConfiguredModelId(currentProviderConfig.modelId)
    if (!parsedModelId) {
      logger.error('Invalid OpenClaw model id configured', {
        modelId: currentProviderConfig.modelId,
        toolId: selectedCliTool,
        providerId: enabledProvider.id
      })
      await upsertProviderConfig(enabledProvider.id, { modelId: '' })
      await setCurrentProvider(null)
      window.toast.error(t('openclaw.error.select_provider_model'))
      return
    }
    const { providerId, modelId: rawModelId } = parsedModelId

    try {
      setLaunching(true)
      setStatus('starting')
      const syncResult = await ipcApi.request('openclaw.sync_config', `${providerId}::${rawModelId}`)
      if (!syncResult.success) {
        setStatus('error')
        window.toast.error(syncResult.message || t('code.launch.error'))
        return
      }

      const startResult = await ipcApi.request('openclaw.start_gateway', undefined)
      if (!startResult.success) {
        setStatus('error')
        window.toast.error(startResult.message || t('code.launch.error'))
        return
      }

      const dashboardUrl = await ipcApi.request('openclaw.get_dashboard_url')
      openSmartMiniApp({
        appId: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: dashboardUrl,
        logo: 'openclaw'
      })
      setStatus('running')
    } catch (err) {
      setStatus('error')
      logger.error('Failed to launch OpenClaw dashboard:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [
    currentProviderConfig,
    enabledProvider,
    openSmartMiniApp,
    selectedCliTool,
    setCurrentProvider,
    upsertProviderConfig,
    t
  ])

  const handleStop = useCallback(async () => {
    try {
      setStopping(true)
      const result = await ipcApi.request('openclaw.stop_gateway')
      if (!result.success) {
        window.toast.error(result.message || t('code.launch.error'))
        return
      }
      setStatus('stopped')
    } catch (err) {
      logger.error('Failed to stop OpenClaw gateway:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setStopping(false)
    }
  }, [t])

  useEffect(() => {
    if (!isOpenClawTool) return

    let cancelled = false
    const refreshStatus = async () => {
      try {
        const nextStatus = await ipcApi.request('openclaw.get_status')
        if (!cancelled) {
          setStatus(nextStatus.status)
        }
      } catch (error) {
        logger.error('Failed to read OpenClaw gateway status:', error as Error)
      }
    }

    void refreshStatus()
    const interval = window.setInterval(refreshStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isOpenClawTool])

  return {
    launching,
    running: isOpenClawTool && status === 'running',
    starting: isOpenClawTool && status === 'starting',
    stopping,
    onLaunch: handleLaunch,
    onStop: handleStop
  }
}
