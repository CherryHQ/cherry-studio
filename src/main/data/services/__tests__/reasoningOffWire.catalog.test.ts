/**
 * Catalog-wide guard for how "turn thinking off" reaches the wire.
 *
 * `none` is the canonical "reasoning can be disabled" marker, but the generic
 * openai-chat/-responses profile spells "off" as the literal effort tier
 * `none` — a value only a few vendors actually accept. Sending it elsewhere is
 * a 400 (#17900), so this walks the real catalog and asserts the emission
 * surface instead of trusting per-provider review.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  EndpointType,
  ProtoProviderModelOverride,
  ProtoReasoningSupport,
  ProviderModelRoute,
  ReasoningControl
} from '@cherrystudio/provider-registry'
import { resolveModelEndpoint } from '@cherrystudio/provider-registry'
import { projectRuntimeReasoning, resolveReasoningProfileFromRegistry } from '@data/services/ProviderRegistryService'
import { encodeReasoningInvocation, resolveReasoningInvocation } from '@main/ai/utils/reasoningSerializers'
import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

// this file → __tests__ → services → data → main → src → repo root
const dataDir = join(fileURLToPath(import.meta.url), '../../../../../..', 'packages/provider-registry/data')
const read = (file: string) => JSON.parse(readFileSync(join(dataDir, file), 'utf8'))

const models: Array<{ id: string; reasoning?: ProtoReasoningSupport }> = read('models.json').models
const overrides: ProtoProviderModelOverride[] = read('provider-models.json').overrides
const providers: Array<{
  id: string
  defaultChatEndpoint?: EndpointType | null
  modelRouting?: ProviderModelRoute[]
  endpointConfigs?: Record<string, { reasoningFormat?: never }>
}> = read('providers.json').providers

const modelById = new Map(models.map((model) => [model.id, model]))
const providerById = new Map(providers.map((provider) => [provider.id, provider]))

interface OffEmission {
  key: string
  effortValues: readonly string[] | undefined
}

/** Every (provider, model) whose "off" selection puts the literal `none` on the wire. */
function collectOffEmissions(): OffEmission[] {
  const emissions: OffEmission[] = []

  for (const override of overrides) {
    const preset = modelById.get(override.modelId)
    const provider = providerById.get(override.providerId)
    if (!preset || !provider) continue

    // The endpoint the request will use — same resolver the runtime and the projection share.
    const { endpointType } = resolveModelEndpoint({
      endpointTypes: override.endpointTypes,
      modelRouting: provider.modelRouting,
      modelId: override.apiModelId ?? override.modelId,
      defaultChatEndpoint: provider.defaultChatEndpoint
    })
    if (!endpointType) continue

    const contract = override.reasoningContracts?.[endpointType]
    const support = contract?.support ?? preset.reasoning
    if (!support) continue

    const profile = resolveReasoningProfileFromRegistry({
      endpointType,
      format: provider.endpointConfigs?.[endpointType]?.reasoningFormat,
      contract,
      wireDialect: support.wireDialect
    })

    const model = { reasoning: projectRuntimeReasoning(support, profile.wire) } as Model
    const invocation = resolveReasoningInvocation({ selection: 'none', model, profile: profile.wire })
    const encoded = JSON.stringify(encodeReasoningInvocation(invocation))
    if (!encoded.includes('"none"')) continue

    const effortControl = support.controls?.find((control: ReasoningControl) => control.kind === 'effort')
    emissions.push({
      key: `${override.providerId} | ${override.modelId} | ${endpointType}`,
      effortValues: effortControl?.kind === 'effort' ? effortControl.values : undefined
    })
  }

  return emissions
}

describe('reasoning off-wire surface (data/*.json)', () => {
  const emissions = collectOffEmissions()

  it('never writes the literal `none` tier onto a model whose ladder rejects it', () => {
    const unsupported = emissions
      .filter((emission) => emission.effortValues && !emission.effortValues.includes('none'))
      .map((emission) => emission.key)

    expect(unsupported).toEqual([])
  })

  it('locks the providers that still spell "off" as `none` for ladder-less (toggle-only) models', () => {
    // These models declare no effort ladder at all, so nothing contradicts the
    // generic wire and the runtime guard stays out of the way. Kept as-is until
    // each vendor is verified; the list exists so a change here is reviewable.
    const ladderLess = [
      ...new Set(emissions.filter((emission) => !emission.effortValues).map((emission) => emission.key.split(' | ')[0]))
    ].sort()

    expect(ladderLess).toMatchInlineSnapshot(`
      [
        "302ai",
        "copilot",
        "dashscope",
        "dmxapi",
        "fireworks",
        "gateway",
        "huggingface",
        "lanyun",
        "modelscope",
        "openrouter",
        "ppio",
        "qiniu",
        "radeon-cloud",
        "silicon",
        "tokenhub",
      ]
    `)
  })
})
