/**
 * Characterization matrix for the reasoning-effort injection layer (#16598).
 *
 * Builds the (provider, model) rows the golden test freezes, covering the two
 * real model populations:
 *
 *  - CATALOG rows — every reasoning-capable (provider, model) pair the shipped
 *    registry serves: provider-models.json overrides (aggregators) plus each
 *    reasoning-capable models.json entry paired with its first-party provider
 *    (ownedBy → provider id). Resolved through the REAL `mergePresetModel`, so
 *    `model.reasoning` is exactly what production stores in `user_model`.
 *
 *  - SYNTHETIC rows — the custom-model shape (`capabilities: ['reasoning']`,
 *    `reasoning` unset — what `createCustomModel`/`dtoToNewUserModel` produce
 *    for a model the catalog doesn't know), crossed with every provider id the
 *    legacy branch tower special-cases plus a non-system custom provider.
 *
 * Consumed by reasoningContract.test.ts — the permanent invariant gate over
 * both populations. (The byte-level golden matrix this file originally fed
 * was migration scaffolding and has been retired.)
 */
import { resolve } from 'node:path'

import { buildRuntimeEndpointConfigs } from '@cherrystudio/provider-registry'
import {
  readModelRegistry,
  readProviderModelRegistry,
  readProviderRegistry
} from '@cherrystudio/provider-registry/node'
import {
  extractReasoningFormatTypes,
  inferCustomModelReasoning,
  mergePresetModel
} from '@data/services/ProviderRegistryService'
import type { Assistant } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import type { EndpointConfig, Provider } from '@shared/data/types/provider'

const DATA_DIR = resolve(import.meta.dirname, '../../../../../packages/provider-registry/data')

export interface MatrixRow {
  /** `providerId::modelId` — stable member key in the goldens. */
  key: string
  provider: Provider
  model: Model
}

/**
 * models.json has no provider axis; pair each reasoning-capable model with its
 * first-party provider so the matrix covers the providers that serve their own
 * models (which provider-models.json — aggregators only — does not list).
 */
const OWNER_TO_FIRST_PARTY_PROVIDER: Record<string, string> = {
  alibaba: 'dashscope',
  anthropic: 'anthropic',
  baidu: 'baidu-cloud',
  bytedance: 'doubao',
  deepseek: 'deepseek',
  google: 'gemini',
  minimax: 'minimax',
  mistral: 'mistral',
  moonshot: 'moonshot',
  nvidia: 'nvidia',
  openai: 'openai',
  perplexity: 'perplexity',
  stepfun: 'stepfun',
  tencent: 'hunyuan',
  xai: 'grok',
  xiaomi: 'mimo',
  zhipu: 'zhipu'
}

function providerFor(providerId: string): Provider {
  return { id: providerId, name: providerId } as Provider
}

export function buildCatalogRows(): MatrixRow[] {
  const models = readModelRegistry(resolve(DATA_DIR, 'models.json')).models
  const providers = readProviderRegistry(resolve(DATA_DIR, 'providers.json')).providers
  const overrides = readProviderModelRegistry(resolve(DATA_DIR, 'provider-models.json')).overrides

  const modelById = new Map(models.map((m) => [m.id, m]))
  const registryProviderById = new Map(providers.map((p) => [p.id, p]))

  // Mirrors ProviderRegistryService.getRegistryReasoningConfig (registry-only, no DB).
  const configFor = (providerId: string) => {
    const provider = registryProviderById.get(providerId)
    const endpointConfigs = provider
      ? (buildRuntimeEndpointConfigs(provider.endpointConfigs) as Partial<Record<string, EndpointConfig>> | null)
      : null
    return {
      defaultChatEndpoint: provider?.defaultChatEndpoint ?? undefined,
      reasoningFormatTypes: extractReasoningFormatTypes(
        endpointConfigs as Parameters<typeof extractReasoningFormatTypes>[0]
      )
    }
  }

  const rows: MatrixRow[] = []
  const seen = new Set<string>()
  const push = (providerId: string, preset: (typeof models)[number], override: (typeof overrides)[number] | null) => {
    const key = `${providerId}::${preset.id}`
    if (seen.has(key)) return
    seen.add(key)
    const cfg = configFor(providerId)
    const model = mergePresetModel(preset, override, providerId, cfg.reasoningFormatTypes, cfg.defaultChatEndpoint)
    rows.push({ key, provider: providerFor(providerId), model })
  }

  for (const override of overrides) {
    if (override.disabled) continue
    const preset = modelById.get(override.modelId)
    if (!preset || !(preset.capabilities ?? []).includes('reasoning')) continue
    push(override.providerId, preset, override)
  }

  for (const preset of models) {
    if (!(preset.capabilities ?? []).includes('reasoning')) continue
    const providerId = OWNER_TO_FIRST_PARTY_PROVIDER[preset.ownedBy ?? '']
    if (!providerId) continue
    push(providerId, preset, null)
  }

  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Provider ids the legacy tower special-cases (branch-by-provider knowledge
 * that must become registry data), plus first-party ids gating providerId
 * checks (openai deep-research, gemini-hosted gemma) and one non-system
 * custom id (`isSystemProviderId` false → the generic fallthrough).
 */
export const SYNTHETIC_PROVIDER_IDS = [
  'aihubmix',
  'anthropic',
  'cerebras',
  'cherryin',
  'dashscope',
  'deepseek',
  'dmxapi',
  'doubao',
  'gemini',
  'groq',
  'hunyuan',
  'my-custom-openai',
  'new-api',
  'nvidia',
  'ollama',
  'openai',
  'openrouter',
  'poe',
  'ppio',
  'silicon',
  'sophnet',
  'tencent-cloud-ti',
  'together'
] as const

/**
 * One representative id per ThinkModelType family / tower-relevant regex
 * (37-family UI table + THINKING_TOKEN_MAP families + issue-named gap vendors).
 */
export const SYNTHETIC_MODEL_IDS = [
  'acme-reasoner-v1', // no family match — the tower's fallthrough baseline
  'baichuan-m3',
  'claude-3-7-sonnet-20250219',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-sonnet-4-5',
  'deepseek-chat',
  'deepseek-r1',
  'deepseek-reasoner',
  'deepseek-v3.1',
  'deepseek-v4',
  'doubao-1-5-thinking-vision-pro',
  'doubao-seed-1-6-250615',
  'doubao-seed-1-6-251015',
  'doubao-seed-1.8',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash',
  'gemini-3-pro-preview',
  'gemini-3.1-pro',
  'gemini-flash-latest',
  'gemma-4-27b-it',
  'glm-4.5',
  'glm-5',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.2-pro',
  'gpt-oss-120b',
  'grok-3-mini',
  'grok-4-fast',
  'grok-4-fast-non-reasoning',
  'grok-4.3',
  'hunyuan-a13b',
  'hunyuan-t1',
  'kimi-k2-thinking',
  'kimi-k2.5',
  'magistral-medium',
  'mimo-v2-flash',
  'minimax-m2.1',
  'mistral-small-2603',
  'o3',
  'o3-deep-research',
  'qwen-plus',
  'qwen3-235b-a22b-thinking-2507',
  'qwen3-32b',
  'qwen3.5-397b-a17b',
  'qwq-32b',
  'ring-1t',
  'sonar-deep-research',
  'sonar-reasoning-pro',
  'step-3'
] as const

export function buildSyntheticRows(): MatrixRow[] {
  const rows: MatrixRow[] = []
  for (const providerId of SYNTHETIC_PROVIDER_IDS) {
    for (const modelId of SYNTHETIC_MODEL_IDS) {
      rows.push({
        key: `${providerId}::${modelId}`,
        provider: providerFor(providerId),
        model: {
          id: createUniqueModelId(providerId, modelId),
          providerId,
          apiModelId: modelId,
          name: modelId,
          capabilities: ['reasoning'],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        } as Model
      })
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The synthetic population AFTER production's ingest-time inference
 * (`ModelService` create/read paths call `inferCustomModelReasoning` for
 * reasoning-capable rows without a descriptor) — the state real custom rows
 * are served in. Rows whose id matches no heuristic keep `reasoning`
 * undefined and remain knob-less at runtime.
 */
export function buildEnrichedSyntheticRows(): MatrixRow[] {
  const providers = readProviderRegistry(resolve(DATA_DIR, 'providers.json')).providers
  const registryProviderById = new Map(providers.map((p) => [p.id, p]))
  return buildSyntheticRows().map((row) => {
    const provider = registryProviderById.get(row.provider.id)
    const endpointConfigs = provider
      ? (buildRuntimeEndpointConfigs(provider.endpointConfigs) as Partial<Record<string, EndpointConfig>> | null)
      : null
    const reasoning = inferCustomModelReasoning(
      row.model.apiModelId ?? '',
      undefined,
      extractReasoningFormatTypes(endpointConfigs as Parameters<typeof extractReasoningFormatTypes>[0]),
      provider?.defaultChatEndpoint ?? undefined
    )
    return reasoning ? { ...row, model: { ...row.model, reasoning } } : row
  })
}

export function assistantFor(effort: string): Assistant {
  return { settings: effort === 'unset' ? {} : { reasoning_effort: effort } } as Assistant
}
