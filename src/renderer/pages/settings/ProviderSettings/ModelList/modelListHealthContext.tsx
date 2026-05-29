import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import type { ReactNode } from 'react'
import { createContext, use, useMemo } from 'react'

import { useHealthCheck } from './useHealthCheck'

interface ModelListHealthContextValue {
  isHealthChecking: boolean
  availableApiKeys: string[]
  healthCheckOpen: boolean
  openHealthCheck: () => void
  closeHealthCheck: () => void
  resetHealthCheckRun: () => void
  startHealthCheck: (config: { apiKeys: string[]; isConcurrent: boolean; timeout: number }) => Promise<void>
  modelStatusMap: Map<string, ModelWithStatus>
  modelStatuses: ModelWithStatus[]
}

const ModelListHealthContext = createContext<ModelListHealthContextValue | null>(null)

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
  const value = useMemo(
    () => ({
      isHealthChecking,
      availableApiKeys,
      healthCheckOpen,
      openHealthCheck,
      closeHealthCheck,
      resetHealthCheckRun,
      startHealthCheck,
      modelStatusMap: new Map(modelStatuses.map((status) => [status.model.id, status])),
      modelStatuses
    }),
    [
      availableApiKeys,
      closeHealthCheck,
      healthCheckOpen,
      isHealthChecking,
      modelStatuses,
      openHealthCheck,
      resetHealthCheckRun,
      startHealthCheck
    ]
  )

  return <ModelListHealthContext value={value}>{children}</ModelListHealthContext>
}

export function useModelListHealth() {
  const context = use(ModelListHealthContext)

  if (!context) {
    throw new Error('useModelListHealth must be used within ModelListHealthProvider')
  }

  return context
}
