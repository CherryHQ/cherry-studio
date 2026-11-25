import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePersistCache } from '@data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'

export function useLocalAgentModelCatalog(
  identity: string,
  config: LocalAgentConfiguration | undefined,
  enabled: boolean
) {
  const [catalogs, setCatalogs] = usePersistCache('local_agent.model_catalogs')
  const signature = JSON.stringify([
    identity,
    config?.protocol,
    config?.presetId,
    config?.executableOverride,
    config?.args,
    Object.entries(config?.env ?? {}).sort(([a], [b]) => a.localeCompare(b))
  ])
  const [fingerprint, setFingerprint] = useState<{ signature: string; key: string }>()
  const key = fingerprint?.signature === signature ? fingerprint.key : undefined
  const requestConfig = useMemo<LocalAgentConfiguration | undefined>(() => {
    const [, protocol, presetId, executableOverride, args, env] = JSON.parse(signature)
    if (!protocol) return undefined
    return {
      protocol,
      presetId: presetId ?? undefined,
      executableOverride: executableOverride ?? undefined,
      args,
      env: Object.fromEntries(env),
      enabled: true
    }
  }, [signature])
  const [loadingKey, setLoadingKey] = useState<string>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const pending = useRef<{ key: string; promise: Promise<void> } | undefined>(undefined)

  const fingerprintPromise = useMemo(
    () =>
      crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(signature))
        .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')),
    [signature]
  )
  const [fresh, setFresh] = useState<{ key: string; catalog: LocalAgentModelCatalog }>()
  useEffect(() => {
    let active = true
    // Persist only a digest: arguments and environment may contain credentials.
    void fingerprintPromise.then((key) => {
      if (active) setFingerprint({ signature, key })
    })
    return () => {
      active = false
    }
  }, [signature, fingerprintPromise])

  const refresh = useCallback(async () => {
    if (!requestConfig) return
    const key = await fingerprintPromise
    if (pending.current?.key === key) return pending.current.promise
    setLoadingKey(key)
    setFailure(undefined)
    const promise = (async () => {
      try {
        const catalog = await ipcApi.request('ai.local_agents.models', requestConfig)
        if (pending.current?.key === key) setFresh({ key, catalog })
        setCatalogs((previous) =>
          Object.fromEntries(
            Object.entries({ ...previous, [key]: { catalog, updatedAt: Date.now() } })
              .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
              .slice(0, 100)
          )
        )
      } catch (error) {
        if (pending.current?.key === key) setFailure({ key, message: String(error) })
        throw error
      } finally {
        if (pending.current?.key === key) pending.current = undefined
        setLoadingKey((current) => (current === key ? undefined : current))
      }
    })()
    pending.current = { key, promise }
    return promise
  }, [fingerprintPromise, requestConfig, setCatalogs])

  useEffect(() => {
    if (enabled) void refresh().catch(() => {})
  }, [enabled, refresh])

  const catalog = key ? catalogs[key]?.catalog : undefined
  return {
    catalog,
    freshCatalog: key && fresh?.key === key ? fresh.catalog : undefined,
    loading: !!key && loadingKey === key,
    refreshError: failure?.key === key ? failure?.message : undefined,
    error: !catalog && failure?.key === key ? failure?.message : undefined,
    refresh
  }
}
