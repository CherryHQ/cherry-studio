import { cacheService } from '@data/CacheService'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
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
 * - Config flows through the DataApi preference layer (`feature.api_gateway.*`).
 * - Running state is published by Main to the shared cache (Main is
 *   authoritative); the renderer observes it read-only via `useSharedCacheValue`
 *   (no default write-back into the Main-owned key). No IPC ready-broadcast or
 *   EventEmitter listener is involved.
 * - Start/stop/restart remain imperative IPC commands; Main updates the shared
 *   cache as part of activation, so `apiGatewayRunning` updates on its own.
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

  const setApiGatewayEnabled = useCallback(
    (enabled: boolean) => {
      void setApiGatewayConfig({ enabled })
    },
    [setApiGatewayConfig]
  )

  // Resolves `true` only when Main confirms the server is listening (its IPC `start()` succeeds
  // after the server binds). Returns `false` on the loading no-op, an unsuccessful IPC result, or a
  // thrown error, so callers that gate on a running gateway (e.g. the code-CLI gateway provider) can
  // tell a real start from a swallowed failure instead of trusting a stale persisted key.
  const startApiGateway = useCallback(async (): Promise<boolean> => {
    if (apiGatewayLoading) return false
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.start')
      if (result.success) {
        setApiGatewayEnabled(true)
        toast.success(t('apiGateway.messages.startSuccess'))
        return true
      }
      toast.error(t('apiGateway.messages.startError') + result.error)
      return false
    } catch (error: any) {
      toast.error(t('apiGateway.messages.startError') + (error.message || error))
      return false
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, setApiGatewayEnabled, t])

  const stopApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.stop')
      if (result.success) {
        setApiGatewayEnabled(false)
        toast.success(t('apiGateway.messages.stopSuccess'))
      } else {
        toast.error(t('apiGateway.messages.stopError') + result.error)
      }
    } catch (error: any) {
      toast.error(t('apiGateway.messages.stopError') + (error.message || error))
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, setApiGatewayEnabled, t])

  const restartApiGateway = useCallback(async () => {
    if (apiGatewayLoading) return
    setApiGatewayLoading(true)
    try {
      const result = await ipcApi.request('api_gateway.restart')
      if (result.success) {
        setApiGatewayEnabled(result.success)
        toast.success(t('apiGateway.messages.restartSuccess'))
      } else {
        toast.error(t('apiGateway.messages.restartError') + result.error)
      }
    } catch (error) {
      toast.error(t('apiGateway.messages.restartFailed') + (error as Error).message)
    } finally {
      setApiGatewayLoading(false)
    }
  }, [apiGatewayLoading, setApiGatewayEnabled, t])

  // Keep the UI toggle in sync when Main auto-starts the gateway (e.g. when
  // agents exist) while the persisted `enabled` flag is still false.
  useEffect(() => {
    if (apiGatewayRunning && !apiGatewayConfig.enabled) {
      setApiGatewayEnabled(true)
    }
  }, [apiGatewayRunning, apiGatewayConfig.enabled, setApiGatewayEnabled])

  return {
    apiGatewayConfig,
    apiGatewayRunning,
    apiGatewayLoading,
    startApiGateway,
    stopApiGateway,
    restartApiGateway,
    setApiGatewayEnabled,
    setApiGatewayConfig
  }
}
