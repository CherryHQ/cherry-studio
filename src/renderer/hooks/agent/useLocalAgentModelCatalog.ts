import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePersistCache } from '@data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

export function useLocalAgentModelCatalog(identity: string, config: LocalAgentConfiguration, enabled: boolean) {
  const [catalogs, setCatalogs] = usePersistCache('local_agent.model_catalogs')
  const signature = JSON.stringify([
    identity,
    config.protocol,
    config.presetId,
    config.executableOverride,
    config.args,
    Object.entries(config.env).sort(([a], [b]) => a.localeCompare(b))
  ])
  const [fingerprint, setFingerprint] = useState<{ signature: string; key: string }>()
  const key = fingerprint?.signature === signature ? fingerprint.key : undefined
  const requestConfig = useMemo<LocalAgentConfiguration>(() => {
    const [, protocol, presetId, executableOverride, args, env] = JSON.parse(signature)
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

  useEffect(() => {
    let active = true
    // Persist only a digest: arguments and environment may contain credentials.
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)).then((digest) => {
      if (active) {
        setFingerprint({
          signature,
          key: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        })
      }
    })
    return () => {
      active = false
    }
  }, [signature])

  const refresh = useCallback(async () => {
    if (!key) return
    if (pending.current?.key === key) return pending.current.promise
    setLoadingKey(key)
    setFailure(undefined)
    const promise = (async () => {
      try {
        const catalog = await ipcApi.request('ai.local_agents.models', requestConfig)
        setCatalogs((previous) =>
          Object.fromEntries(
            Object.entries({ ...previous, [key]: { catalog, updatedAt: Date.now() } })
              .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
              .slice(0, 100)
          )
        )
      } catch (error) {
        setFailure({ key, message: String(error) })
        throw error
      } finally {
        if (pending.current?.key === key) pending.current = undefined
        setLoadingKey((current) => (current === key ? undefined : current))
      }
    })()
    pending.current = { key, promise }
    return promise
  }, [key, requestConfig, setCatalogs])

  useEffect(() => {
    if (enabled) void refresh().catch(() => {})
  }, [enabled, refresh])

  const catalog = key ? catalogs[key]?.catalog : undefined
  return {
    catalog,
    loading: !!key && loadingKey === key,
    error: !catalog && failure?.key === key ? failure?.message : undefined,
    refresh
  }
}
