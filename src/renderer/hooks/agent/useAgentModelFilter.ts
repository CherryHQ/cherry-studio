/**
 * Filter that gates the model picker shown to an agent.
 *
 * Each runtime contributes its compatibility predicate through the shared
 * capability matrix. Claude Code uses the API Gateway's routability predicate;
 * Pi additionally validates that its provider wire protocol is supported.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
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

const CHERRY_CLOUD_AVAILABILITY_KEY = 'agent/cherry-cloud-model-availability'
const CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS = 60_000
const EMPTY_CHERRY_CLOUD_AVAILABILITY = { entitledModelIds: [], quotaExhaustedModelIds: [] }

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
export function useAgentModelDisabled(): ModelPredicate {
  const { data: cloudAvailability, mutate } = useSWR(
    CHERRY_CLOUD_AVAILABILITY_KEY,
    () => ipcApi.request('cherry_cloud.models.sync'),
    {
      dedupingInterval: 5_000,
      refreshInterval: CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS,
      revalidateOnReconnect: false,
      shouldRetryOnError: false
    }
  )

  useIpcOn('cherry_cloud.status_changed', (status) => {
    void mutate(EMPTY_CHERRY_CLOUD_AVAILABILITY, { revalidate: status.phase === 'signed-in' }).catch(() => undefined)
  })

  return useMemo(
    () => (model: Model) =>
      isManagedCherryCloudModel(model.providerId) &&
      (!cloudAvailability ||
        !cloudAvailability.entitledModelIds.includes(model.id) ||
        cloudAvailability.quotaExhaustedModelIds.includes(model.id)),
    [cloudAvailability]
  )
}
