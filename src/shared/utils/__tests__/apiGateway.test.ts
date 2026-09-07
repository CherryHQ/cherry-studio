import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ANTIGRAVITY_MODEL_PATH_SEPARATOR, formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { describe, expect, it } from 'vitest'

/** The gateway proxy's parse side (proxyStream.ts): split on the FIRST ':'. */
function parseByFirstColon(gatewayModelId: string): { providerId: string; modelId: string } {
  const sepIdx = gatewayModelId.indexOf(':')
  return { providerId: gatewayModelId.slice(0, sepIdx), modelId: gatewayModelId.slice(sepIdx + 1) }
}

/** The Antigravity round-trip: producer builds the path, `routes/gemini.ts` splits on the FIRST separator. */
function parseAntigravityPath(gatewayModelId: string): { providerId: string; modelId: string } {
  const path = gatewayModelId.replace(':', ANTIGRAVITY_MODEL_PATH_SEPARATOR)
  const sepIdx = path.indexOf(ANTIGRAVITY_MODEL_PATH_SEPARATOR)
  return {
    providerId: path.slice(0, sepIdx),
    modelId: path.slice(sepIdx + ANTIGRAVITY_MODEL_PATH_SEPARATOR.length)
  }
}

describe('formatGatewayModelId', () => {
  it('formats "providerId:apiModelId" and round-trips through the first-colon split', () => {
    const id = formatGatewayModelId('deepseek', 'deepseek-chat')
    expect(id).toBe('deepseek:deepseek-chat')
    expect(parseByFirstColon(id)).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })

  it('round-trips an apiModelId that itself contains ":"', () => {
    const id = formatGatewayModelId('vertexai', 'publishers/google:gemini-2.5-pro')
    expect(parseByFirstColon(id)).toEqual({ providerId: 'vertexai', modelId: 'publishers/google:gemini-2.5-pro' })
  })

  it('rejects a provider id containing ":" — the first-colon split would route it to the wrong provider', () => {
    // "corp:west" + "model" would format to "corp:west:model" and parse back as provider "corp".
    expect(() => formatGatewayModelId('corp:west', 'model')).toThrow(/cannot be addressed/)
  })

  it('rejects the CherryAI managed default model (mirrors the gateway guard)', () => {
    expect(() => formatGatewayModelId(CHERRYAI_PROVIDER_ID, CHERRYAI_DEFAULT_MODEL_ID)).toThrow(/CherryAI/)
  })

  it('formats a colon address for a provider id containing the Antigravity separator', () => {
    // That separator only makes an address ambiguous in Antigravity's path form, so the
    // constraint belongs to that producer — the colon address here round-trips fine.
    const id = formatGatewayModelId('team/models/west', 'gemini-2.5-pro')
    expect(parseByFirstColon(id)).toEqual({ providerId: 'team/models/west', modelId: 'gemini-2.5-pro' })
  })

  it('round-trips an apiModelId that itself contains the Antigravity separator', () => {
    const id = formatGatewayModelId('provider-a', 'models/gemini-flash')
    expect(parseAntigravityPath(id)).toEqual({ providerId: 'provider-a', modelId: 'models/gemini-flash' })
  })
})

describe('gatewayClientOrigin', () => {
  it('maps wildcard binds to a reachable loopback address', () => {
    // A bind host is not a connect target: a CLI subprocess handed 0.0.0.0 has no host to dial.
    expect(gatewayClientOrigin('0.0.0.0', 23333)).toBe('http://127.0.0.1:23333')
    expect(gatewayClientOrigin('::', 23333)).toBe('http://[::1]:23333')
  })

  it('brackets an IPv6 literal so the URL parses', () => {
    expect(() => new URL(gatewayClientOrigin('fe80::1', 23333))).not.toThrow()
    expect(gatewayClientOrigin('fe80::1', 23333)).toBe('http://[fe80::1]:23333')
  })

  it('leaves an ordinary host untouched', () => {
    expect(gatewayClientOrigin('127.0.0.1', 23333)).toBe('http://127.0.0.1:23333')
    expect(gatewayClientOrigin('localhost', 8080)).toBe('http://localhost:8080')
  })
})
