import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { ApiGatewayRuntimeAddress } from '@shared/types/apiGateway'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const API_GATEWAY_PREFERENCE_KEYS = {
  enabled: 'feature.api_gateway.enabled',
  host: 'feature.api_gateway.host',
  port: 'feature.api_gateway.port',
  apiKey: 'feature.api_gateway.api_key'
} as const

/**
 * API Gateway hook.
 *
 * - Config flows through the Preference subsystem (`feature.api_gateway.*`).
 * - Running state is published by Main to the shared cache (Main is
 *   authoritative); the renderer observes it read-only via `useSharedCacheValue`
 *   (no default write-back into the Main-owned key). No IPC ready-broadcast or
 *   EventEmitter listener is involved.
 * - Start/stop/restart remain imperative IPC commands; Main updates the shared
 *   cache as part of activation, so `apiGatewayRunning` updates on its own.
 * - Main persists `enabled` inside those commands. The renderer must NOT write it
 *   back: a second, unawaited write is what let a failed persist diverge from the
 *   running state and reopen the port on the next launch (#18521).
 */
export const useApiGateway = () => {
  const { t } = useTranslation()

  const [apiGatewayConfig, setApiGatewayConfig] = useMultiplePreferences(API_GATEWAY_PREFERENCE_KEYS)

  const apiGatewayRunning = useSharedCacheValue('feature.api_gateway.running') ?? false

  // Tracks an in-flight start/stop/restart command (for button spinners) AND the
  // initial shared-cache hydration window. Starts `true` until the shared cache is
  // ready, so consumers (e.g. AgentPage) don't transiently read the default
  // `running=false` and flash a "server stopped" screen before Main's value arrives.
  const [apiGatewayLoading, setApiGatewayLoading] = useState(() => !cacheService.isSharedCacheReady())

  useEffect(() => {
    if (cacheService.isSharedCacheReady()) return
    return cacheService.onSharedCacheReady(() => setApiGatewayLoading(false))
  }, [])

  // Return Main's bound address so callers never infer runtime state from possibly stale
  // preferences; `null` means startup was skipped or failed.
  const startApiGateway = useCallback(async (): Promise<ApiGatewayRuntimeAddress | null> => {
    if (apiGatewayLoading) return null
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.start')
      if (result.success) {
        if (!apiGatewayRunning) toast.success(t('apiGateway.messages.startSuccess'))
        return result.address
      }
      toast.error(t('apiGateway.messages.startError') + result.error)
      return null
    } catch (error: any) {
      toast.error(t('apiGateway.messages.startError') + (error.message || error))
      return null
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, apiGatewayRunning, t])

  const getApiGatewayRuntimeAddress = useCallback(
    (): Promise<ApiGatewayRuntimeAddress | null> => ipcApi.request('api_gateway.get_runtime_address'),
    []
  )

  const stopApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.stop')
      if (result.success) {
        if (result.outcome === 'deferred') {
          toast.info(t('apiGateway.messages.stopDeferred'))
        } else {
          toast.success(t('apiGateway.messages.stopSuccess'))
        }
      } else {
        toast.error(t('apiGateway.messages.stopError') + result.error)
      }
    } catch (error: any) {
      toast.error(t('apiGateway.messages.stopError') + (error.message || error))
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, t])

  const restartApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.restart')
      if (result.success) {
        toast.success(t('apiGateway.messages.restartSuccess'))
      } else {
        toast.error(t('apiGateway.messages.restartError') + result.error)
      }
    } catch (error) {
      toast.error(t('apiGateway.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, t])

  return {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayLoading,
    getApiGatewayRuntimeAddress,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayConfig
  }
}
