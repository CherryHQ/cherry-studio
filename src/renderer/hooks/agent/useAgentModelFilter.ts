/**
 * Filter that gates the model picker shown to an agent.
 *
 * Each runtime contributes its compatibility predicate through the shared
 * capability matrix. Claude Code uses the API Gateway's routability predicate;
 * Pi additionally validates that its provider wire protocol is supported.
 *
 * Default `null`-typed agents require the text-generation operation; models
 * may still expose embedding, rerank, or image generation alongside it.
 */

import { ipcApi, useIpcOn } from '@renderer/ipc'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isNonChatModel } from '@shared/utils/model'
import { useMemo } from 'react'
import useSWR from 'swr'

const baseAgentFilter = (model: Model): boolean => !isNonChatModel(model)
const CHERRY_CLOUD_AVAILABILITY_KEY = 'cherry-cloud/model-availability'
const CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS = 60_000
const EMPTY_CHERRY_CLOUD_AVAILABILITY = {
  entitledModelIds: [],
  quotaExhaustedModelIds: []
}

type ModelPredicate = (model: Model, provider?: Provider) => boolean

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): ModelPredicate {
  return useMemo<ModelPredicate>(() => {
    const caps = agentType ? AGENT_RUNTIME_CAPABILITIES[agentType] : undefined
    return (model, provider) => {
      if (!baseAgentFilter(model)) return false
      return !caps?.isModelCompatible || caps.isModelCompatible(provider, model)
    }
  }, [agentType])
}

/** Returns the Agent selector rule for models that stay visible but cannot be selected. */
export function useAgentModelDisabled(enabled = true): ModelPredicate {
  const { data: cloudAvailability, mutate } = useSWR(
    enabled ? CHERRY_CLOUD_AVAILABILITY_KEY : null,
    () => ipcApi.request('cherry_cloud.models.sync'),
    {
      dedupingInterval: 5_000,
      refreshInterval: CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS,
      revalidateOnReconnect: false,
      shouldRetryOnError: false
    }
  )

  useIpcOn('cherry_cloud.status_changed', () => {
    if (!enabled) return
    void mutate(EMPTY_CHERRY_CLOUD_AVAILABILITY, { revalidate: true }).catch(() => undefined)
  })

  return useMemo(() => {
    const entitledModelIds = new Set(cloudAvailability?.entitledModelIds)
    const quotaExhaustedModelIds = new Set(cloudAvailability?.quotaExhaustedModelIds)
    return (model: Model) =>
      isManagedCherryCloudModel(model.providerId) &&
      (!cloudAvailability || !entitledModelIds.has(model.id) || quotaExhaustedModelIds.has(model.id))
  }, [cloudAvailability])
}
