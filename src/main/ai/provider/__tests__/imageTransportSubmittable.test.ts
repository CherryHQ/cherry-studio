import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { VendorBag } from '@main/ai/utils/imageOptions'
import type { ImageGenerationMode } from '@shared/data/types/model'
import { describe, expect, it, vi } from 'vitest'

import { captureImageRequest } from '../custom/__tests__/boundary/captureRequest'
import type { ImageGenerationSubmitInput, ImageTransportDescriptor } from '../custom/imageGenerationModel'
import { resolveImageTransport } from '../custom/imageTransportRegistry'

/**
 * The direction `imageParamDeliverability` cannot cover: it treats "this model has a
 * transport" as proof its params arrive, but a transport is free to REFUSE the model
 * outright — `ppioTransport.submit` throws `Unknown model` when the registry declares
 * no `modes[mode].vendorTransport`, and DashScope throws `Missing modelDescriptor`.
 * A declared image model routed to such a transport renders a full control panel and
 * fails on every click, with the deliverability suite green.
 *
 * So: walk the registry, route each declared (provider, model, mode) through the real
 * `resolveImageTransport`, build the descriptor exactly as `AiService.generateImage`
 * does, and require that `submit()` reaches the network. Both halves come from the
 * producer — registry data and the transport's own behaviour — so neither can be an
 * echo of the other.
 */

vi.mock('@main/i18n', () => ({ t: (key: string) => key }))

const dataDir = resolve(process.cwd(), 'packages/provider-registry/data')
const readJson = (file: string) => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8'))

type ModeDef = { vendorTransport?: { endpoint: string; isSync?: boolean } }
type ImageGenerationSupport = { modes: Record<string, ModeDef> }

const presetModels: Array<{ id: string; imageGeneration?: ImageGenerationSupport }> = readJson('models.json').models
const overrides: Array<{
  providerId: string
  modelId: string
  apiModelId?: string
  imageGeneration?: ImageGenerationSupport
}> = readJson('provider-models.json').overrides

const presetById = new Map(presetModels.map((m) => [m.id, m]))

/** `apiKey` + both `baseURL` spellings the transport builders read. */
const PROBE_SETTINGS = {
  apiKey: 'sk-test',
  baseURL: 'https://example.invalid',
  imageBaseURL: 'https://example.invalid'
}

/** Mirrors `ProviderRegistryService.getImageGenerationSupport`: an override wins wholesale. */
const declarations = overrides.flatMap((override) => {
  const support = override.imageGeneration ?? presetById.get(override.modelId)?.imageGeneration
  if (!support) return []
  // Both the transport gate and the descriptor id are `model.apiModelId ?? model.id`
  // (`AiService.generateImage` → `transportModelId`), NOT the registry's canonical key:
  // DashScope declares `wanx2-1-t2i-turbo` and dispatches on `wanx2.1-t2i-turbo`.
  const modelId = override.apiModelId ?? override.modelId
  return Object.entries(support.modes).flatMap(([mode, def]) => {
    // `resolveImageTransport` is keyed on the concrete provider id, which for a registry
    // row IS `override.providerId` (a user's renamed copy resolves via its preset id).
    const transport = resolveImageTransport(
      override.providerId as never,
      modelId,
      PROBE_SETTINGS,
      override.providerId as never
    )
    if (!transport) return []
    return [{ providerId: override.providerId, modelId, mode, def, transport }]
  })
})

/** Exactly what `AiService.generateImage` derives from the registry — nothing invented. */
function descriptorFor(modelId: string, mode: string, def: ModeDef): ImageTransportDescriptor | undefined {
  const endpoint = def.vendorTransport?.endpoint
  return endpoint
    ? { id: modelId, endpoint, isSync: def.vendorTransport?.isSync, mode: mode as ImageGenerationMode }
    : undefined
}

function submitInput(overrides: Partial<ImageGenerationSubmitInput<VendorBag>>): ImageGenerationSubmitInput<VendorBag> {
  return {
    modelId: 'unused',
    prompt: 'a cat',
    n: 1,
    size: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerParams: {},
    ...overrides
  }
}

describe('every transport-routed registry image model is submittable', () => {
  it('routes a meaningful number of models through a transport', () => {
    expect(declarations.length).toBeGreaterThan(10)
    expect(new Set(declarations.map((d) => d.providerId)).size).toBeGreaterThan(2)
  })

  it.each(declarations)('$providerId / $modelId ($mode)', async ({ modelId, mode, def, transport }) => {
    const input = submitInput({ modelId, modelDescriptor: descriptorFor(modelId, mode, def) })

    // `captureImageRequest` rethrows only when the transport failed BEFORE fetching —
    // i.e. it rejected the model itself rather than the canned `{}` response.
    const request = await captureImageRequest(transport, input)

    expect(request.url).toContain('example.invalid')
  })
})
