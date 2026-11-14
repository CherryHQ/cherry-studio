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
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { resolveLaunchModelId } from '../cliConfig'
import { useManagedToolStatus } from './useManagedToolStatus'

const logger = loggerService.withContext('useOpenClawGatewayController')

interface UseOpenClawGatewayControllerOptions {
  selectedCliTool: CodeCli
  openClawVersion?: string
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
}

type StartupOperation = 'Sync OpenClaw configuration' | 'Start OpenClaw gateway' | 'Open OpenClaw dashboard'

interface OpenClawGatewayController {
  launching: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  startupError: { operation: StartupOperation; message: string } | null
  onLaunch: () => Promise<void>
  onStop: () => Promise<void>
  onOpenDashboard: () => Promise<void>
  onCopyStartupError: () => Promise<void>
  onDismissStartupError: () => void
}

export function useOpenClawGatewayController({
  selectedCliTool,
  openClawVersion,
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
  const [startupError, setStartupError] = useState<OpenClawGatewayController['startupError']>(null)

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

    let operation: StartupOperation = 'Sync OpenClaw configuration'
    try {
      setLaunching(true)
      const syncResult = await ipcApi.request('openclaw.sync_config', {
        uniqueModelId: parsedModelId.uniqueModelId,
        port: gatewayPort
      })
      if (!syncResult.success) {
        setStartupError({
          operation,
          message: redactSecretTokens(redactSecretText(syncResult.message))
        })
        return
      }

      operation = 'Start OpenClaw gateway'
      const startResult = await ipcApi.request('openclaw.start_gateway', { port: gatewayPort })
      if (!startResult.success) {
        setStartupError({
          operation,
          message: redactSecretTokens(redactSecretText(startResult.message))
        })
        return
      }

      operation = 'Open OpenClaw dashboard'
      await openDashboard()
    } catch (err) {
      logger.error('Failed to launch OpenClaw dashboard:', err as Error)
      const message = err instanceof Error ? err.message : String(err)
      setStartupError({
        operation,
        message: redactSecretTokens(redactSecretText(message))
      })
    } finally {
      setLaunching(false)
    }
  }, [currentProviderConfig, enabledProvider, gatewayPort, openDashboard, setCurrentProvider, upsertProviderConfig])

  const handleCopyStartupError = useCallback(async () => {
    if (!startupError) return

    const appVersion = await ipcApi
      .request('app.get_info')
      .then(({ version }) => version)
      .catch(() => 'unknown')
    const details = [
      `Operation: ${startupError.operation}`,
      `Error: ${startupError.message}`,
      `Cherry Studio version: ${appVersion}`,
      `OpenClaw version: ${openClawVersion ?? 'unknown'}`
    ].join('\n')

    try {
      await navigator.clipboard.writeText(redactSecretTokens(redactSecretText(details)))
      toast.success(t('common.copied'))
    } catch {
      toast.error(t('common.copy_failed'))
    }
  }, [openClawVersion, startupError, t])

  const handleDismissStartupError = useCallback(() => setStartupError(null), [])

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
    startupError,
    onLaunch: handleLaunch,
    onStop: handleStop,
    onOpenDashboard: handleOpenDashboard,
    onCopyStartupError: handleCopyStartupError,
    onDismissStartupError: handleDismissStartupError
  }
}
