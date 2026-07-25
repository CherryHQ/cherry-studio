import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { wireName } from '@cherrystudio/provider-registry'
import type { CanonicalParamKey, EndpointType } from '@shared/data/types/model'
import type { AuthConfig } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { nativeBindingFor } from '../../utils/aiSdkNativeBindings'
import { resolveImageTransport } from '../custom/imageTransportRegistry'
import { resolveWireRegistration, type WireProfile } from '../custom/wire/wireProfile'

/**
 * The contract missing when #17394 / #17360 happened: **a declared image param must
 * be deliverable**. The registry is the declaration layer — a `supports` entry there
 * renders a control in the paintings UI — but nothing checked that the runtime wire
 * for that provider can actually carry the param. #17360 declared Seedream's controls
 * with CI fully green while every one of them was silently dropped.
 *
 * This walks every (provider, model) pair the registry declares image generation for,
 * resolves it through the REAL production path (`providerToAiSdkConfig` →
 * `resolveWireRegistration` / `resolveImageTransport`), and asserts each declared
 * canonical key has a route to the wire. It duplicates no resolution logic, so it
 * cannot drift from production.
 *
 * SCOPE — this catches the **silently-dropped** class, not "every control works".
 * Two of the four routes are satisfied for a whole provider at once: `passthrough`
 * sprays any key into the body by construction, and a transport receives the whole
 * bag whether or not its hand-written builder reads the key. A key with the wrong
 * name for its vendor still passes — ppio's `jimeng-txt2img-v3-0` declares
 * `promptEnhancement` while `ppioTransport` reads `usePreLlm`, and this test is
 * green on it. Tightening that needs a per-vendor accepted-field set, which the
 * `custom/__tests__/boundary/` snapshots own model by model. Read a green run as
 * "no declared key is dropped on the way to the wire" — nothing stronger.
 *
 * The second suite below closes the reverse direction, which needs no vendor knowledge:
 * a `passthrough: 'wire'` key must not carry a wire name that OVERWRITES a body field
 * the SDK already wrote.
 */

// providerToAiSdkConfig reads the rotated API key (and Vertex/Bedrock auth) off the
// direct-import ProviderService singleton; mock it so the builders run without a DB.
const { getRotatedApiKeyMock, getAuthConfigMock, getByProviderIdMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<(providerId: string) => string>(() => 'sk-test'),
  // Vertex refuses to build without iam-gcp credentials; supply a stub so its rows run.
  getAuthConfigMock: vi.fn<(providerId: string) => AuthConfig | null>(
    () => ({ type: 'iam-gcp', project: 'p', location: 'us-central1' }) as AuthConfig
  ),
  getByProviderIdMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    getAuthConfig: getAuthConfigMock,
    getByProviderId: getByProviderIdMock
  }
}))

const { providerToAiSdkConfig } = await import('../config')

// ── Registry data (the declaration layer) ──

const dataDir = resolve(process.cwd(), 'packages/provider-registry/data')
const readJson = (file: string) => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8'))

type SupportRecord = Record<string, unknown>
type ImageGenerationSupport = { modes: Record<string, { supports?: SupportRecord }> }

const providers: Array<{
  id: string
  defaultChatEndpoint?: EndpointType
  endpointConfigs?: Record<string, { baseUrl?: string; adapterFamily?: string }>
}> = readJson('providers.json').providers
const presetModels: Array<{ id: string; imageGeneration?: ImageGenerationSupport }> = readJson('models.json').models
const overrides: Array<{
  providerId: string
  modelId: string
  endpointTypes?: EndpointType[]
  imageGeneration?: ImageGenerationSupport
}> = readJson('provider-models.json').overrides

const providerById = new Map(providers.map((p) => [p.id, p]))
const presetById = new Map(presetModels.map((m) => [m.id, m]))

/** Mirrors `ProviderRegistryService.getImageGenerationSupport`: override wins wholesale. */
function imageSupportFor(override: (typeof overrides)[number]): ImageGenerationSupport | null {
  return override.imageGeneration ?? presetById.get(override.modelId)?.imageGeneration ?? null
}

const declarations = overrides.flatMap((override) => {
  const support = imageSupportFor(override)
  const provider = providerById.get(override.providerId)
  if (!support || !provider) return []
  return Object.entries(support.modes).map(([mode, def]) => ({
    override,
    provider,
    mode,
    keys: Object.keys(def.supports ?? {})
  }))
})

// ── Deliverability ──

/** Canonical keys the renderer resolves before the request reaches main. */
const RENDERER_ONLY_KEYS = new Set([
  // A width/height pair the paintings form folds into the native `size` (`WxH`)
  // before dispatching — see renderer `canonicalGenerate.ts`.
  'customSize'
])

function profileCovers(profile: WireProfile, key: string): boolean {
  return (profile.forward ?? []).includes(key as never) || key in (profile.fields ?? {})
}

/** Resolve a declaration through the real production path — no resolution logic here. */
function resolveSdkConfig({ override, provider }: (typeof declarations)[number]) {
  return providerToAiSdkConfig(
    makeProvider({
      id: provider.id,
      defaultChatEndpoint: provider.defaultChatEndpoint,
      endpointConfigs: provider.endpointConfigs as never
    }),
    makeModel({
      id: `${override.providerId}::${override.modelId}`,
      apiModelId: override.modelId,
      providerId: override.providerId,
      endpointTypes: override.endpointTypes
    })
  )
}

describe('registry image params are deliverable on the runtime wire', () => {
  it('covers every provider that declares image generation', () => {
    expect(declarations.length).toBeGreaterThan(0)
    expect(new Set(declarations.map((d) => d.override.providerId)).size).toBeGreaterThan(5)
  })

  it.each(declarations)('$override.providerId / $override.modelId ($mode)', async (declaration) => {
    const { override, keys } = declaration
    const sdkConfig = await resolveSdkConfig(declaration)

    // A transport builds its own envelope from the raw canonical bag, so every key
    // reaches it; otherwise the key must be a native AI SDK option, mapped by the
    // provider's wire profile, or carried by its passthrough.
    const registration = resolveWireRegistration(sdkConfig.providerId)
    const hasTransport = Boolean(
      resolveImageTransport(
        sdkConfig.providerId,
        override.modelId,
        sdkConfig.providerSettings,
        sdkConfig.concreteProviderId
      )
    )
    const profiles = [registration.profile, ...(registration.also ?? []).map((a) => a.profile)]

    const undeliverable = keys.filter(
      (key) =>
        !RENDERER_ONLY_KEYS.has(key) &&
        !hasTransport &&
        !registration.passthrough &&
        !nativeBindingFor(key) &&
        !profiles.some((profile) => profileCovers(profile, key))
    )

    expect(undeliverable, `no wire route under providerOptions.${sdkConfig.optionsKey}`).toEqual([])
  })
})

/**
 * Fields `@ai-sdk/openai-compatible` writes into the image body itself, BEFORE spreading
 * the passthrough bag: `{ model, prompt, n, size, ...args }` — args last, so it wins.
 */
const OPENAI_COMPAT_OWNED_BODY_FIELDS = new Set(['model', 'prompt', 'n', 'size'])

/** The canonical key `AI_SDK_NATIVE_BINDINGS` routes into each owned field. */
const NATIVE_KEY_BY_OWNED_FIELD: Record<string, string | undefined> = { n: 'numImages', size: 'size' }

/**
 * The other half of the contract: a `passthrough: 'wire'` body IS the HTTP body, so a
 * declared key whose catalog wire name collides with a field the SDK already wrote
 * OVERWRITES it rather than adding to it — the control silently wins over the native
 * param, which is the #17394 failure mode with the arrow reversed.
 *
 * `imageResolution` is the live hazard (catalog wire name `size`). No model declares it
 * alongside the native `size` today, so this passes; it fails the day one does.
 */
describe('wire-passthrough bodies do not shadow a native AI SDK field', () => {
  it('no declared key overwrites a body field the SDK writes itself', async () => {
    const offenders: string[] = []

    for (const declaration of declarations) {
      const sdkConfig = await resolveSdkConfig(declaration)
      if (resolveWireRegistration(sdkConfig.providerId).passthrough !== 'wire') continue

      const { keys } = declaration
      const shadowing = keys.filter((key) => {
        if (nativeBindingFor(key)) return false // native keys are routed, never in the bag
        const field = wireName(key as CanonicalParamKey)
        if (!OPENAI_COMPAT_OWNED_BODY_FIELDS.has(field)) return false
        // `model`/`prompt` are always written, so any collision is real; `n`/`size` only
        // carry a value when the model also declares the native key.
        const nativeKey = NATIVE_KEY_BY_OWNED_FIELD[field]
        return nativeKey === undefined || keys.includes(nativeKey)
      })

      if (shadowing.length > 0) {
        const { override, mode } = declaration
        offenders.push(`${override.providerId}/${override.modelId} (${mode}): ${shadowing.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
