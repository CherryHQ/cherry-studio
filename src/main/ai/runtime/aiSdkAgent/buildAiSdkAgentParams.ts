/**
 * Agent-runtime parameter assembly for the `ai-sdk` runtime.
 *
 * Consumes the shared lower-level AI SDK builders (`resolveSdkConfig`,
 * `applyHttpTrace`, `buildTelemetry`, `createAiRepair`) with agent-owned
 * inputs — it never constructs a fake `Assistant` and never imports renderer
 * state. Chat-only behavior (assistant prompt variables, KB scoping,
 * attachment routing, feature plugins) stays in `buildAgentParams`.
 */

import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { stepCountIs } from 'ai'

import { createAiRepair } from '../../tools/adapters/aiSdk/repair'
import { type AgentOptions, applyHttpTrace, buildTelemetry, resolveSdkConfig, type SdkConfig } from '../aiSdk'
import type { AgentSkillCatalogEntry } from './skillCatalog'
import { buildSkillCatalogSection } from './skillCatalog'
import { assertAiSdkAgentProviderUsable } from './validateModel'
import { buildWorkspaceContextSection, readWorkspaceContextFiles } from './workspaceContext'

/**
 * Step cap when the agent has no explicit `max_turns`. Deliberately higher
 * than chat's default 20: agent tasks routinely chain many tool steps, and
 * the host turn is still bounded by abort/close.
 */
export const DEFAULT_AI_SDK_AGENT_MAX_TURNS = 100

export interface BuildAiSdkAgentParamsInput {
  agent: Pick<AgentEntity, 'id' | 'instructions' | 'configuration'>
  sessionId: string
  workspacePath: string
  provider: Provider
  model: Model
  /**
   * Enabled managed skills to advertise in the system prompt. Pass only when
   * the `skill` tool is registered on the same request — the section tells
   * the model to call it.
   */
  skills?: readonly AgentSkillCatalogEntry[]
  /** Stable id for span attribution (the turn's assistant message id). */
  requestId?: string
}

export interface BuiltAiSdkAgentParams {
  sdkConfig: SdkConfig
  system: string | undefined
  options: AgentOptions
  maxTurns: number
}

export async function buildAiSdkAgentParams(input: BuildAiSdkAgentParamsInput): Promise<BuiltAiSdkAgentParams> {
  const { agent, sessionId, workspacePath, provider, model, skills, requestId } = input

  assertAiSdkAgentProviderUsable(provider, model)

  const sdkConfig = await resolveSdkConfig(provider, model)
  applyHttpTrace(sdkConfig, sessionId, model)

  const system = await assembleAgentSystemPrompt(agent, workspacePath, skills)
  const maxTurns = resolveMaxTurns(agent.configuration?.max_turns)

  const options: AgentOptions = {
    maxRetries: 0,
    stopWhen: stepCountIs(maxTurns),
    repairToolCall: createAiRepair({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: sdkConfig.modelId
    })
  }
  const telemetry = buildTelemetry({
    topicId: sessionId,
    requestId: requestId ?? crypto.randomUUID(),
    model,
    sdkConfig
  })
  if (telemetry) options.telemetry = telemetry

  return { sdkConfig, system, options, maxTurns }
}

function resolveMaxTurns(configured: number | undefined): number {
  if (configured !== undefined && Number.isInteger(configured) && configured > 0) return configured
  return DEFAULT_AI_SDK_AGENT_MAX_TURNS
}

async function assembleAgentSystemPrompt(
  agent: BuildAiSdkAgentParamsInput['agent'],
  workspacePath: string,
  skills: readonly AgentSkillCatalogEntry[] | undefined
): Promise<string | undefined> {
  const sections: string[] = []

  const instructions = agent.instructions?.trim()
  if (instructions) sections.push(instructions)

  const contextFiles = await readWorkspaceContextFiles(workspacePath)
  sections.push(buildWorkspaceContextSection(workspacePath, contextFiles))

  if (skills?.length) {
    const skillSection = buildSkillCatalogSection(skills)
    if (skillSection) sections.push(skillSection)
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined
}
