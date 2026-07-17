import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { ReactNode } from 'react'
import { createContext, use, useMemo } from 'react'

import { useHealthCheck } from './useHealthCheck'

interface ModelListHealthRunContextValue {
  isHealthChecking: boolean
  availableApiKeys: string[]
  healthCheckOpen: boolean
  openHealthCheck: () => void
  closeHealthCheck: () => void
  resetHealthCheckRun: () => void
  startHealthCheck: (config: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => Promise<void>
}

interface ModelListHealthResultsContextValue {
  modelStatusMap: Map<string, ModelWithStatus>
  modelStatuses: ModelWithStatus[]
}

const ModelListHealthRunContext = createContext<ModelListHealthRunContextValue | null>(null)
const ModelListHealthResultsContext = createContext<ModelListHealthResultsContextValue | null>(null)

export function ModelListHealthProvider({ providerId, children }: { providerId: string; children: ReactNode }) {
  const {
    isChecking: isHealthChecking,
    modelStatuses,
    availableApiKeys,
    healthCheckOpen,
    openHealthCheck,
    closeHealthCheck,
    resetHealthCheckRun,
    startHealthCheck
  } = useHealthCheck(providerId)
  const runValue = useMemo(
    () => ({
      isHealthChecking,
      availableApiKeys,
      healthCheckOpen,
      openHealthCheck,
      closeHealthCheck,
      resetHealthCheckRun,
      startHealthCheck
    }),
    [
      availableApiKeys,
      closeHealthCheck,
      healthCheckOpen,
      isHealthChecking,
      openHealthCheck,
      resetHealthCheckRun,
      startHealthCheck
    ]
  )
  const resultsValue = useMemo(
    () => ({
      modelStatusMap: new Map(modelStatuses.map((status) => [status.model.id, status])),
      modelStatuses
    }),
    [modelStatuses]
  )

  return (
    <ModelListHealthRunContext value={runValue}>
      <ModelListHealthResultsContext value={resultsValue}>{children}</ModelListHealthResultsContext>
    </ModelListHealthRunContext>
  )
}

export function useModelListHealthRun() {
  const context = use(ModelListHealthRunContext)

  if (!context) {
    throw new Error('useModelListHealthRun must be used within ModelListHealthProvider')
  }

  return context
}

export function useModelListHealth() {
  const run = useModelListHealthRun()
  const results = use(ModelListHealthResultsContext)
  const context = useMemo(() => (results ? { ...run, ...results } : null), [results, run])

  if (!context) {
    throw new Error('useModelListHealth must be used within ModelListHealthProvider')
  }

  return context
}
