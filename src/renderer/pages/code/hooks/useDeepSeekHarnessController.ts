import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId, normalizeDeepSeekHarnessSettings } from '@shared/types/codeCli'

import { resolveLaunchModelId } from '../cliConfig'
import { useManagedToolStatus } from './useManagedToolStatus'

const logger = loggerService.withContext('useDeepSeekHarnessController')

interface UseDeepSeekHarnessControllerOptions {
  selectedCliTool: CodeCli
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
}

interface DeepSeekHarnessController {
  launching: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  onLaunch: () => Promise<void>
  onStop: () => Promise<boolean>
  onOpenWebUi: () => Promise<void>
}

export function useDeepSeekHarnessController({
  selectedCliTool,
  enabledProvider,
  currentProviderConfig,
  upsertProviderConfig,
  setCurrentProvider
}: UseDeepSeekHarnessControllerOptions): DeepSeekHarnessController {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const isDeepSeekHarness = selectedCliTool === CodeCli.DEEPSEEK_HARNESS
  // Status comes from main-pushed events (single source of truth); only the local
  // launching/stopping intents live here, covering the gap until events arrive.
  const { status, url } = useManagedToolStatus('deepseek-harness', isDeepSeekHarness)
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)
  const settings = useMemo(
    () => normalizeDeepSeekHarnessSettings(currentProviderConfig?.config),
    [currentProviderConfig?.config]
  )

  const openWebUi = useCallback(
    (webUrl: string) => {
      const target = new URL(webUrl)
      target.searchParams.set('cherry_navigation_revision', String(Date.now()))
      openSmartMiniApp({
        appId: 'deepseek-harness-web',
        name: 'DeepSeek Harness',
        url: target.toString(),
        logo: 'deepseek'
      })
    },
    [openSmartMiniApp]
  )

  const handleLaunch = useCallback(async () => {
    const parsedModelId = await resolveLaunchModelId({
      enabledProvider,
      currentProviderConfig,
      upsertProviderConfig,
      setCurrentProvider,
      errorToastKey: 'code.select_provider_model',
      logLabel: 'Invalid DeepSeek Harness model id configured'
    })
    if (!parsedModelId || !enabledProvider) return

    try {
      setLaunching(true)
      const result = await ipcApi.request('deepseek_harness.start', {
        mode: isApiGatewayProviderId(enabledProvider.id) ? 'gateway' : 'direct',
        uniqueModelId: parsedModelId.uniqueModelId,
        ...settings
      })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      openWebUi(result.url)
    } catch (error) {
      logger.error('Failed to launch DeepSeek Harness', error as Error)
      toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [currentProviderConfig, enabledProvider, openWebUi, setCurrentProvider, settings, t, upsertProviderConfig])

  const handleStop = useCallback(async (): Promise<boolean> => {
    try {
      setStopping(true)
      const result = await ipcApi.request('deepseek_harness.stop')
      if (!result.success) {
        toast.error(result.message)
        return false
      }
      return true
    } catch (error) {
      logger.error('Failed to stop DeepSeek Harness', error as Error)
      toast.error(t('code.launch.error'))
      return false
    } finally {
      setStopping(false)
    }
  }, [t])

  const handleOpenWebUi = useCallback(async () => {
    try {
      if (url) {
        openWebUi(url)
        return
      }
      const current = await ipcApi.request('deepseek_harness.get_status')
      if (current.status !== 'running' || !current.url) throw new Error('DeepSeek Harness Web UI is not running')
      openWebUi(current.url)
    } catch (error) {
      logger.error('Failed to open DeepSeek Harness Web UI', error as Error)
      toast.error(t('code.launch.error'))
    }
  }, [openWebUi, t, url])

  return {
    launching: isDeepSeekHarness && launching,
    running: isDeepSeekHarness && status === 'running',
    starting: isDeepSeekHarness && status === 'starting',
    stopping: isDeepSeekHarness && stopping,
    onLaunch: handleLaunch,
    onStop: handleStop,
    onOpenWebUi: handleOpenWebUi
  }
}
