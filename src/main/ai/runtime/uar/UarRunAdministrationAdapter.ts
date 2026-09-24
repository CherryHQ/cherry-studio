import { application } from '@application'
import type { UarRunDetailSnapshot, UarRunInspection } from '@shared/types/prometheusIntegration'

import {
  body,
  ownerRequest,
  owners,
  projectRun,
  rawCheckpointResponse,
  rawRun
} from './UarOperationalAdministrationAdapter'
async function resolveRun(runId: string, generation: number): Promise<{ sessionId: string; run: UarRunInspection }> {
  for (const current of owners()) {
    const response = await ownerRequest(current.sessionId, `/api/uar/runs/${encodeURIComponent(runId)}`, {}, generation)
    if (response.status === 404) continue
    return {
      sessionId: current.sessionId,
      run: projectRun(rawRun.parse(await body(response, 'Run detail')), current.sessionId)
    }
  }
  throw new Error('The selected run is no longer available to any UAR conversation')
}

export async function readUarRunDetail(runId: string): Promise<UarRunDetailSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  const resolved = await resolveRun(runId, endpoint.generation)
  const checkpoints = rawCheckpointResponse.parse(
    await body(
      await ownerRequest(
        resolved.sessionId,
        `/api/uar/runs/${encodeURIComponent(runId)}/checkpoints`,
        {},
        endpoint.generation
      ),
      'Run checkpoints'
    )
  )
  const sessionId = resolved.run.conversationId
  const inspect = async (path: string) => {
    if (!sessionId) return undefined
    const response = await ownerRequest(resolved.sessionId, path, {}, endpoint.generation)
    if (response.status === 404) return undefined
    return body(response, 'Run context')
  }
  const [agentConfig, effectiveConfig, contextStats, promptCaching, conversationPolicy] = await Promise.all([
    inspect(`/api/uar/sessions/${encodeURIComponent(sessionId ?? '')}/agent-config`),
    inspect(`/api/uar/sessions/${encodeURIComponent(sessionId ?? '')}/effective-config`),
    inspect(`/api/uar/sessions/${encodeURIComponent(sessionId ?? '')}/context-stats`),
    inspect(`/api/uar/sessions/${encodeURIComponent(sessionId ?? '')}/prompt-caching`),
    inspect(`/api/uar/conversations/${encodeURIComponent(sessionId ?? '')}/policy`)
  ])
  return {
    schemaVersion: 1,
    generation: endpoint.generation,
    run: resolved.run,
    checkpoints: checkpoints.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      nodeId: checkpoint.node_id,
      iteration: checkpoint.iteration,
      createdAt: checkpoint.created_at,
      completeness: checkpoint.protection?.completeness ?? 'incomplete_legacy'
    })),
    context: {
      ...(agentConfig !== undefined ? { agentConfig } : {}),
      ...(effectiveConfig !== undefined ? { effectiveConfig } : {}),
      ...(contextStats !== undefined ? { contextStats } : {}),
      ...(promptCaching !== undefined ? { promptCaching } : {}),
      ...(conversationPolicy !== undefined ? { conversationPolicy } : {})
    }
  }
}

export async function cancelUarRun(runId: string): Promise<UarRunDetailSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  const resolved = await resolveRun(runId, endpoint.generation)
  await body(
    await ownerRequest(
      resolved.sessionId,
      `/api/uar/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
      endpoint.generation
    ),
    'Run cancellation'
  )
  return readUarRunDetail(runId)
}

export async function saveUarConversationPolicy(
  runId: string,
  policy?: Record<string, unknown>
): Promise<UarRunDetailSnapshot> {
  const endpoint = await application.get('UarSidecarService').ensureReady()
  const resolved = await resolveRun(runId, endpoint.generation)
  const conversationId = resolved.run.conversationId
  if (!conversationId) throw new Error('The selected run has no conversation policy scope')
  await body(
    await ownerRequest(
      resolved.sessionId,
      `/api/uar/conversations/${encodeURIComponent(conversationId)}/policy`,
      policy
        ? {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(policy)
          }
        : { method: 'DELETE' },
      endpoint.generation
    ),
    policy ? 'Conversation policy update' : 'Conversation policy reset'
  )
  return readUarRunDetail(runId)
}
