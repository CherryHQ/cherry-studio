import { useCallback, useEffect, useMemo, useState } from 'react'

import { ipcApi } from '@renderer/ipc'
import {
  integrationConfigSchema,
  type IntegrationAction,
  type IntegrationConfig,
  type IntegrationSecret,
  type IntegrationSecretPatch,
  type IntegrationSnapshot,
  type IntegrationUpdate
} from '@shared/types/prometheusIntegration'

export function useIntegrationSettings() {
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot | null>(null)
  const [draft, setDraft] = useState<IntegrationConfig>(() => integrationConfigSchema.parse({}))
  const [secrets, setSecrets] = useState<Partial<Record<IntegrationSecret, string>>>({})
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [startingAction, setStartingAction] = useState<IntegrationAction | null>(null)
  const dirty =
    snapshot !== null && (JSON.stringify(draft) !== JSON.stringify(snapshot.config) || Object.keys(secrets).length > 0)
  const running = snapshot?.operations.some((operation) => operation.status === 'running') ?? false
  const busy = saving || startingAction !== null || running

  const load = useCallback(async () => {
    try {
      const value = await ipcApi.request('prometheus.integration.snapshot', {})
      setSnapshot(value)
      setDraft(value.config)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!running) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await ipcApi.request('prometheus.integration.snapshot', {})
        if (!disposed) {
          setSnapshot(next)
          setError(null)
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (!disposed) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 500)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [running])

  const save = useCallback(async () => {
    if (!snapshot) return
    setSaving(true)
    setError(null)
    try {
      const updates: IntegrationUpdate[] = []
      for (const feature of ['compass', 'filesystem', 'uar', 'services'] as const) {
        if (JSON.stringify(draft[feature]) === JSON.stringify(snapshot.config[feature])) continue
        updates.push({
          feature,
          expectedRevision: snapshot.revisions[feature],
          value: draft[feature]
        } as IntegrationUpdate)
      }
      const secretPatch = Object.fromEntries(
        Object.entries(secrets).map(([name, value]) => [name, { operation: 'set', value }])
      ) as IntegrationSecretPatch
      const next = await ipcApi.request('prometheus.integration.configure', { updates, secrets: secretPatch })
      setSnapshot(next)
      setDraft(next.config)
      setSecrets({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }, [draft, secrets, snapshot])

  const start = useCallback(
    async (action: IntegrationAction, workspacePath = workspace || undefined) => {
      setStartingAction(action)
      setError(null)
      try {
        const operation = await ipcApi.request('prometheus.integration.start', { action, workspacePath })
        setSnapshot((current) =>
          current ? { ...current, operations: [operation, ...current.operations].slice(0, 20) } : current
        )
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStartingAction(null)
      }
    },
    [workspace]
  )

  const cancel = useCallback(async (id: string) => {
    try {
      await ipcApi.request('prometheus.integration.cancel', { id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const update = useCallback(
    <K extends keyof IntegrationConfig>(section: K, values: Partial<IntegrationConfig[K]>) =>
      setDraft((current) => ({ ...current, [section]: { ...current[section], ...values } })),
    []
  )

  const setSecret = useCallback((key: IntegrationSecret, value: string) => {
    setSecrets((current) => {
      const next = { ...current }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }, [])

  const activeOperation = useMemo(
    () => snapshot?.operations.find((operation) => operation.status === 'running') ?? null,
    [snapshot?.operations]
  )

  return {
    snapshot,
    draft,
    secrets,
    workspace,
    error,
    saving,
    startingAction,
    dirty,
    busy,
    activeOperation,
    load,
    save,
    start,
    cancel,
    update,
    setSecret,
    setWorkspace
  }
}

export type IntegrationSettingsController = ReturnType<typeof useIntegrationSettings>
