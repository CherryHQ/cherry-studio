/**
 * Bridge a Cherry {@link ProviderTransportAdapter} onto a pi provider config's
 * `streamSimple`, keeping the pi runtime generic.
 *
 * pi registers a provider `streamSimple` as THE stream for its `api` family
 * (`model-registry`: `registerApiProvider({ api, stream, streamSimple })`). We
 * make that `streamSimple` delegate to pi-ai's DEFAULT openai-responses stream —
 * the exact implementation pi would otherwise use — after injecting the
 * adapter's per-call `{ apiKey, headers, onPayload }`. pi never sees any
 * grok/codex specifics; the adapter owns "how to call me".
 *
 * The api-family functions are dynamic-imported in the connection's async
 * `start()` and passed in here (see {@link PiAiStreamFns}), because pi calls
 * `streamSimple` SYNCHRONOUSLY: `lazyStream` returns a stream immediately and
 * runs the async credential resolution behind it, so the fns must already be in
 * hand when that sync call happens.
 */
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

import type { ProviderTransportAdapter } from '../../provider/runtimeTransport'
import type { loadPiAi, loadPiOpenAiResponsesApi } from './piSdk'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
type PiStreamOnPayload = NonNullable<NonNullable<Parameters<PiStreamSimple>[2]>['onPayload']>

/** The pi-ai api-family functions a transport-stream needs, pre-loaded by the caller. */
export interface PiAiStreamFns {
  lazyStream: Awaited<ReturnType<typeof loadPiAi>>['lazyStream']
  apiStreamSimple: Awaited<ReturnType<typeof loadPiOpenAiResponsesApi>>['streamSimple']
}

/**
 * Compose the adapter's payload rewrite AFTER any `onPayload` pi already set:
 * call pi's first (honoring its returned override), then reshape into the
 * provider's accepted body. Always returns a defined value so pi replaces the params.
 */
function composeOnPayload(
  existing: PiStreamOnPayload | undefined,
  adapter: ProviderTransportAdapter
): PiStreamOnPayload {
  return async (payload, model) => {
    let json = payload
    if (existing) {
      const next = await existing(payload, model)
      if (next !== undefined) json = next
    }
    return adapter.rewritePayload(json as Record<string, any>)
  }
}

/**
 * Return a copy of `config` whose `streamSimple` streams through `adapter`.
 * Per call: resolve a fresh OAuth token, layer the provider headers over pi's,
 * and reshape the payload — then hand off to pi-ai's openai-responses stream.
 *
 * Auth is made precedence-independent: the token is passed in BOTH `apiKey` (the
 * OpenAI client's own Authorization source) and the adapter headers (merged last,
 * so they also override any placeholder `Authorization` pi seeded from the config).
 */
export function withTransportStream(
  config: ProviderConfig,
  adapter: ProviderTransportAdapter,
  fns: PiAiStreamFns
): ProviderConfig {
  const streamSimple: PiStreamSimple = (model, context, options) =>
    fns.lazyStream(model, async () => {
      const creds = await adapter.resolveCredentials()
      const headers = adapter.buildHeaders(creds, model.id)
      // Adapter providers always register with the openai-responses api family
      // (see `loadPiAiStreamFns`), so the model is narrowed to that family's
      // stream function; pi's generic `Model<Api>` is widened only at the boundary.
      return fns.apiStreamSimple(model as Parameters<PiAiStreamFns['apiStreamSimple']>[0], context, {
        ...options,
        apiKey: creds.accessToken,
        headers: { ...options?.headers, ...headers },
        onPayload: composeOnPayload(options?.onPayload, adapter)
      })
    })
  return { ...config, streamSimple }
}
