import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'

/**
 * Build the gateway-addressable model id the gateway routes expect: `providerId:apiModelId`
 * (single colon, `apiModelId` — NOT the `::`-separated internal `UniqueModelId`). The gateway
 * splits on the first `:` (see `apiGateway/proxyStream.ts`) and advertises the same shape from
 * `/v1/models` (see `apiGateway/utils/models.ts`), so both the CLI-config writer and the in-app
 * Claude Code runtime must format ids identically. CherryAI managed default models are not
 * routable through the gateway and throw, mirroring the gateway's own guard.
 */
export function formatGatewayModelId(providerId: string, apiModelId: string): string {
  // The single-colon format cannot round-trip a provider id that itself contains ':' —
  // the gateway would split "corp:west:model" at the first ':' and route to "corp".
  // Fail loudly rather than emit an address that silently targets the wrong provider.
  if (providerId.includes(':')) {
    throw new Error(`Provider id "${providerId}" contains ":" and cannot be addressed through the API gateway`)
  }
  if (isManagedCherryAiDefaultModel(providerId, apiModelId)) {
    throw new Error('CherryAI managed default model is not available through the API gateway')
  }
  return `${providerId}:${apiModelId}`
}

/**
 * Sentinel suffix on the gateway model id handed to gemini-cli (`--model` and
 * `settings.model.name`). gemini-cli normalizes model names it thinks are its own:
 * its `resolveModel` rewrites anything satisfying `endsWith("flash")` (or equal to
 * aliases like `flash`/`auto`) to a default Gemini model, which corrupts any
 * `providerId:apiModelId` address whose model happens to end in "flash" (e.g.
 * `agent/deepseek-v4-flash` → sent as `gemini-3.5-flash`). The suffix makes the
 * string unrecognizable to those checks and rides along verbatim in the request
 * URL; the gateway's Gemini route (and the CLI-config connection readback) strip
 * exactly one trailing sentinel via {@link stripGeminiGatewayModelSuffix}.
 */
export const GEMINI_GATEWAY_MODEL_SUFFIX = '@cherry'

/** {@link formatGatewayModelId} plus the gemini-cli sentinel suffix (see above). */
export function formatGeminiGatewayModelId(providerId: string, apiModelId: string): string {
  return `${formatGatewayModelId(providerId, apiModelId)}${GEMINI_GATEWAY_MODEL_SUFFIX}`
}

/** Undo {@link formatGeminiGatewayModelId}: strip one trailing sentinel, if present. */
export function stripGeminiGatewayModelSuffix(model: string): string {
  return model.endsWith(GEMINI_GATEWAY_MODEL_SUFFIX) ? model.slice(0, -GEMINI_GATEWAY_MODEL_SUFFIX.length) : model
}
