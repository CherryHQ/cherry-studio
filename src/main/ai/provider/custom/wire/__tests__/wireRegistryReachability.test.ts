import { describe, expect, it } from 'vitest'

import { resolveImageTransport } from '../../imageTransportRegistry'
import { WIRE_REGISTRY } from '../wireProfile'

/**
 * A `WIRE_REGISTRY` row is consulted on the **SDK delivery branch only**
 * (`AiService.generateImage` picks the transport branch first). So a provider whose
 * every image model resolves a transport can never read its profile — the row is dead
 * code that still reads like a live declaration, and the two disagree about the vendor
 * bag's vocabulary (the SDK body is wire-named; a transport takes canonical camelCase).
 *
 * `dashscope` was exactly that: `DASHSCOPE_WIRE_PROFILE` declared `negative_prompt` /
 * `seed` / `style` while `dashscopeTransport` read `negativePrompt` / `seed` / `style`
 * off the raw bag, and nothing ever built the profile's body. This keeps the next one
 * from being added.
 *
 * Providers whose transport is *conditional* on the model (dmxapi's bespoke families,
 * tokenhub's `hy-image*`) legitimately keep a row for the models that stay on the SDK
 * path, so the probe below only flags the unconditional ones.
 */

/** Settings shaped like a resolved provider config — enough for every `build*Transport`. */
const PROBE_SETTINGS = { baseURL: 'https://example.invalid', apiKey: 'sk-probe' }

/** A model id no conditional resolver claims, so a transport here means "unconditional". */
const PROBE_MODEL_ID = '__reachability-probe-model__'

describe('WIRE_REGISTRY has no rows shadowed by an unconditional transport', () => {
  it('every registered provider can still reach the SDK delivery branch', () => {
    const shadowed = Object.keys(WIRE_REGISTRY).filter((providerId) =>
      Boolean(resolveImageTransport(providerId, PROBE_MODEL_ID, PROBE_SETTINGS, providerId))
    )

    expect(shadowed, 'these rows can never be read — the provider always takes a transport').toEqual([])
  })

  it('the probe is meaningful — an unconditional transport provider is detectable', () => {
    // Guards the guard: if this stops resolving, the test above silently passes for
    // every provider and the invariant is no longer enforced.
    expect(resolveImageTransport('dashscope', PROBE_MODEL_ID, PROBE_SETTINGS, 'dashscope')).not.toBeNull()
  })
})
