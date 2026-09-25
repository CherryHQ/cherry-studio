import { useCallback, useEffect, useState } from 'react'

import { ipcApi, literGatewayCatalogApi } from '@renderer/ipc'
import type {
  LiterConfigApplyResult,
  LiterConfigExportResult,
  LiterConfigPreview,
  LiterConfigSnapshot,
  LiterConfigSource
} from '@shared/types/literConfig'
import type {
  LiterAliasMutation,
  LiterConnectionMutation,
  LiterGatewayCatalogSnapshot,
  LiterGatewaySelection
} from '@shared/types/literGateway'

type LiterAction =
  | 'load'
  | 'refresh'
  | 'select-gateway'
  | 'save-connection'
  | 'delete-connection'
  | 'save-alias'
  | 'delete-alias'
  | 'select-config'
  | 'read-config'
  | 'preview-config'
  | 'apply-config'
  | 'export-config'

type WithoutExpectedRevision<T> = T extends { expectedRevision: number } ? Omit<T, 'expectedRevision'> : never

export function useLiterGatewayAdministration() {
  const [catalog, setCatalog] = useState<LiterGatewayCatalogSnapshot>()
  const [configSource, setConfigSource] = useState<LiterConfigSource>({ ownership: 'managed' })
  const [config, setConfig] = useState<LiterConfigSnapshot>()
  const [configResult, setConfigResult] = useState<
    LiterConfigPreview | LiterConfigApplyResult | LiterConfigExportResult
  >()
  const [action, setAction] = useState<LiterAction>()
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()

  const run = useCallback(async <T>(name: LiterAction, operation: () => Promise<T>): Promise<T | undefined> => {
    setAction(name)
    setError(undefined)
    setStatus(undefined)
    try {
      return await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      setAction(undefined)
    }
  }, [])

  const readConfig = useCallback(
    async (source: LiterConfigSource) => {
      const next = await run('read-config', () => ipcApi.request('prometheus.liter_config.read', { source }))
      if (next) {
        setConfigSource(source)
        setConfig(next)
        setConfigResult(undefined)
      }
      return next
    },
    [run]
  )

  const load = useCallback(async () => {
    await run('load', async () => {
      const [nextCatalog, nextConfig] = await Promise.all([
        literGatewayCatalogApi.read(),
        ipcApi.request('prometheus.liter_config.read', { source: configSource })
      ])
      setCatalog(nextCatalog)
      setConfig(nextConfig)
    })
  }, [configSource, run])

  useEffect(() => {
    void load()
  }, [load])

  const refreshCatalog = useCallback(async () => {
    const next = await run('refresh', () => literGatewayCatalogApi.refresh())
    if (next) setCatalog(next)
    return next
  }, [run])

  const selectGateway = useCallback(
    async (selection: WithoutExpectedRevision<LiterGatewaySelection>) => {
      if (!catalog) return
      const next = await run('select-gateway', () =>
        literGatewayCatalogApi.selectGateway({
          ...selection,
          expectedRevision: catalog.revision
        } as LiterGatewaySelection)
      )
      if (next) setCatalog(next)
      return next
    },
    [catalog, run]
  )

  const saveConnection = useCallback(
    async (mutation: Omit<LiterConnectionMutation, 'expectedRevision'>) => {
      if (!catalog) return
      const next = await run('save-connection', () =>
        literGatewayCatalogApi.saveConnection({
          ...mutation,
          expectedRevision: catalog.revision
        })
      )
      if (next) setCatalog(next)
      return next
    },
    [catalog, run]
  )

  const deleteConnection = useCallback(
    async (providerConnectionId: string) => {
      if (!catalog) return
      const next = await run('delete-connection', () =>
        literGatewayCatalogApi.deleteConnection(providerConnectionId, catalog.revision)
      )
      if (next) setCatalog(next)
      return next
    },
    [catalog, run]
  )

  const saveAlias = useCallback(
    async (mutation: Omit<LiterAliasMutation, 'expectedRevision'>) => {
      if (!catalog) return
      const next = await run('save-alias', () =>
        literGatewayCatalogApi.saveAlias({
          ...mutation,
          expectedRevision: catalog.revision
        })
      )
      if (next) setCatalog(next)
      return next
    },
    [catalog, run]
  )

  const deleteAlias = useCallback(
    async (gatewayConnectionId: string, alias: string) => {
      if (!catalog) return
      const next = await run('delete-alias', () =>
        literGatewayCatalogApi.deleteAlias(gatewayConnectionId, alias, catalog.revision)
      )
      if (next) setCatalog(next)
      return next
    },
    [catalog, run]
  )

  const selectLocalConfig = useCallback(async () => {
    const selection = await run('select-config', () => ipcApi.request('prometheus.liter_config.select_local', {}))
    if (selection && !('cancelled' in selection)) await readConfig(selection)
  }, [readConfig, run])

  const previewConfig = useCallback(async () => {
    if (!config) return
    const result = await run('preview-config', () =>
      ipcApi.request('prometheus.liter_config.preview_saved', {
        source: configSource,
        expectedRevision: config.revision
      })
    )
    if (result) setConfigResult(result)
  }, [config, configSource, run])

  const applyConfig = useCallback(async () => {
    if (!config) return
    const result = await run('apply-config', () =>
      ipcApi.request('prometheus.liter_config.apply_saved', {
        source: configSource,
        expectedRevision: config.revision
      })
    )
    if (result) {
      setConfigResult(result)
      if (result.state === 'restart-required' && result.nextRevision) {
        setConfig((current) => (current ? { ...current, revision: result.nextRevision } : current))
      }
    }
  }, [config, configSource, run])

  const exportConfig = useCallback(
    async (remoteEndpoint?: string) => {
      if (!config) return
      const result = await run('export-config', () =>
        ipcApi.request('prometheus.liter_config.export_saved', {
          source: configSource,
          expectedRevision: config.revision,
          ...(remoteEndpoint ? { remoteEndpoint } : {})
        })
      )
      if (result) setConfigResult(result)
    },
    [config, configSource, run]
  )

  return {
    catalog,
    config,
    configSource,
    configResult,
    action,
    busy: Boolean(action),
    error,
    status,
    setStatus,
    load,
    refreshCatalog,
    selectGateway,
    saveConnection,
    deleteConnection,
    saveAlias,
    deleteAlias,
    readConfig,
    selectLocalConfig,
    previewConfig,
    applyConfig,
    exportConfig
  }
}

export type LiterGatewayAdministrationController = ReturnType<typeof useLiterGatewayAdministration>
