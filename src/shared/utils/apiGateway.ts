import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import { Base64 } from 'js-base64'

export interface GatewayModelAddress {
  readonly providerId: string
  readonly apiModelId: string
}

/**
 * Separator in the versioned custom-model path Antigravity CLI carries under `gemini-api://`.
 */
export const ANTIGRAVITY_MODEL_PATH_SEPARATOR = '/models/'

/** Sentinel suffix that prevents gemini-cli from rewriting model names ending in `flash`. */
export const GEMINI_GATEWAY_MODEL_SUFFIX = '@cherry'

const GATEWAY_MODEL_WIRE_PREFIX = 'cherry-gw-v1'
const GEMINI_GATEWAY_MODEL_PREFIX = `${GATEWAY_MODEL_WIRE_PREFIX}.`
const ANTIGRAVITY_GATEWAY_MODEL_PREFIX = `${GATEWAY_MODEL_WIRE_PREFIX}${ANTIGRAVITY_MODEL_PATH_SEPARATOR}`
const VERSIONED_GEMINI_GATEWAY_PREFIX = /^cherry-gw-v\d+\./
const VERSIONED_ANTIGRAVITY_GATEWAY_PREFIX = /^cherry-gw-v\d+\/models\//
const MAX_LEGACY_ANTIGRAVITY_CANDIDATES = 32

function validateGatewayModelAddress(providerId: string, apiModelId: string): void {
  if (!providerId || !apiModelId) {
    throw new Error('Gateway model provider id and API model id must be non-empty')
  }
  if (providerId.includes(':')) {
    throw new Error(`Provider id "${providerId}" contains ":" and cannot be addressed through the API gateway`)
  }
  if (isManagedCherryAiDefaultModel(providerId, apiModelId)) {
    throw new Error('CherryAI managed default model is not available through the API gateway')
  }
}

function encodeGatewayModelAddress(providerId: string, apiModelId: string): string {
  validateGatewayModelAddress(providerId, apiModelId)
  return Base64.encodeURI(JSON.stringify([providerId, apiModelId]))
}

function decodeGatewayModelAddress(payload: string, protocol: 'Gemini' | 'Antigravity'): GatewayModelAddress {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('Invalid base64url payload')
    const decoded = JSON.parse(Base64.decode(payload))
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== 'string' ||
      typeof decoded[1] !== 'string'
    ) {
      throw new Error('Invalid address tuple')
    }
    const [providerId, apiModelId] = decoded
    validateGatewayModelAddress(providerId, apiModelId)
    if (encodeGatewayModelAddress(providerId, apiModelId) !== payload) throw new Error('Non-canonical payload')
    return { providerId, apiModelId }
  } catch (error) {
    throw new Error(`Invalid ${protocol} gateway model address`, { cause: error })
  }
}

/**
 * The origin a client uses to reach the gateway, derived from its bind host.
 * A bind host is not a connect target: `0.0.0.0`/`::` mean "every interface" and must become a
 * loopback address, and an IPv6 literal needs brackets or the URL is malformed.
 */
export function gatewayClientOrigin(host: string, port: number): string {
  const reachable = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  return `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`
}

/**
 * Build the gateway-addressable model id the gateway routes expect: `providerId:apiModelId`
 * (single colon, `apiModelId` — NOT the `::`-separated internal `UniqueModelId`). The gateway
 * splits on the first `:` (see `apiGateway/proxyStream.ts`) and advertises the same shape from
 * `/v1/models` (see `apiGateway/utils/models.ts`), so both the CLI-config writer and the in-app
 * Claude Code runtime must format ids identically. CherryAI managed default models are not
 * routable through the gateway and throw, mirroring the gateway's own guard.
 */
export function formatGatewayModelId(providerId: string, apiModelId: string): string {
  validateGatewayModelAddress(providerId, apiModelId)
  return `${providerId}:${apiModelId}`
}

/** Parse the public `providerId:apiModelId` gateway form by its first colon. */
export function parseGatewayModelId(value: string): GatewayModelAddress {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    throw new Error(`Invalid model format: "${value}". Expected "providerId:apiModelId".`)
  }
  const providerId = value.slice(0, separatorIndex)
  const apiModelId = value.slice(separatorIndex + 1)
  validateGatewayModelAddress(providerId, apiModelId)
  return { providerId, apiModelId }
}

/** Encode a self-identifying model value that gemini-cli carries unchanged to `/v1beta`. */
export function formatGeminiGatewayModelId(providerId: string, apiModelId: string): string {
  return `${GEMINI_GATEWAY_MODEL_PREFIX}${encodeGatewayModelAddress(providerId, apiModelId)}${GEMINI_GATEWAY_MODEL_SUFFIX}`
}

/** Parse the v1 gemini-cli form, or return `undefined` when the value uses another grammar. */
export function parseGeminiGatewayModelId(value: string): GatewayModelAddress | undefined {
  const versionedPrefix = value.match(VERSIONED_GEMINI_GATEWAY_PREFIX)?.[0]
  if (!versionedPrefix || !value.endsWith(GEMINI_GATEWAY_MODEL_SUFFIX)) return undefined
  const candidatePayload = value.slice(versionedPrefix.length, -GEMINI_GATEWAY_MODEL_SUFFIX.length)
  if (candidatePayload.includes(':')) return undefined
  if (!value.startsWith(GEMINI_GATEWAY_MODEL_PREFIX) || !value.endsWith(GEMINI_GATEWAY_MODEL_SUFFIX)) {
    throw new Error('Invalid Gemini gateway model address')
  }
  const payload = value.slice(GEMINI_GATEWAY_MODEL_PREFIX.length, -GEMINI_GATEWAY_MODEL_SUFFIX.length)
  return decodeGatewayModelAddress(payload, 'Gemini')
}

/** Encode the model path portion used inside Antigravity's `gemini-api://` selector. */
export function formatAntigravityGatewayModelPath(providerId: string, apiModelId: string): string {
  return `${ANTIGRAVITY_GATEWAY_MODEL_PREFIX}${encodeGatewayModelAddress(providerId, apiModelId)}`
}

/** Parse the v1 Antigravity path, or return `undefined` when the value uses another grammar. */
export function parseAntigravityGatewayModelPath(value: string): GatewayModelAddress | undefined {
  const versionedPrefix = value.match(VERSIONED_ANTIGRAVITY_GATEWAY_PREFIX)?.[0]
  if (!versionedPrefix) return undefined
  if (value.slice(versionedPrefix.length).includes(':')) return undefined
  if (!value.startsWith(ANTIGRAVITY_GATEWAY_MODEL_PREFIX)) {
    throw new Error('Invalid Antigravity gateway model address')
  }
  return decodeGatewayModelAddress(value.slice(ANTIGRAVITY_GATEWAY_MODEL_PREFIX.length), 'Antigravity')
}

/** Parse the old suffix wrapper as one compatibility candidate. */
export function parseLegacyGeminiGatewayModelId(value: string): GatewayModelAddress | undefined {
  if (!value.endsWith(GEMINI_GATEWAY_MODEL_SUFFIX)) return undefined
  try {
    return parseGatewayModelId(value.slice(0, -GEMINI_GATEWAY_MODEL_SUFFIX.length))
  } catch {
    return undefined
  }
}

/** Enumerate every old `/models/` split; the enabled catalog must choose a unique candidate. */
export function parseLegacyAntigravityGatewayModelPaths(value: string): GatewayModelAddress[] {
  const candidates: GatewayModelAddress[] = []
  let separatorIndex = value.indexOf(ANTIGRAVITY_MODEL_PATH_SEPARATOR)
  while (separatorIndex > 0) {
    if (candidates.length >= MAX_LEGACY_ANTIGRAVITY_CANDIDATES) {
      throw new Error('Legacy Antigravity gateway model address has too many separators')
    }
    const providerId = value.slice(0, separatorIndex)
    const apiModelId = value.slice(separatorIndex + ANTIGRAVITY_MODEL_PATH_SEPARATOR.length)
    if (apiModelId && !providerId.includes(':')) candidates.push({ providerId, apiModelId })
    separatorIndex = value.indexOf(
      ANTIGRAVITY_MODEL_PATH_SEPARATOR,
      separatorIndex + ANTIGRAVITY_MODEL_PATH_SEPARATOR.length
    )
  }
  return candidates
}
