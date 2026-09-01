import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import {
  formatAntigravityGatewayModelPath,
  formatGatewayModelId,
  formatGeminiGatewayModelId,
  gatewayClientOrigin,
  parseAntigravityGatewayModelPath,
  parseGatewayModelId,
  parseGeminiGatewayModelId
} from '@shared/utils/apiGateway'
import { describe, expect, it } from 'vitest'

describe('formatGatewayModelId', () => {
  it('formats "providerId:apiModelId" and round-trips through the first-colon split', () => {
    const id = formatGatewayModelId('deepseek', 'deepseek-chat')
    expect(id).toBe('deepseek:deepseek-chat')
    expect(parseGatewayModelId(id)).toEqual({ providerId: 'deepseek', apiModelId: 'deepseek-chat' })
  })

  it('round-trips an apiModelId that itself contains ":"', () => {
    const id = formatGatewayModelId('vertexai', 'publishers/google:gemini-2.5-pro')
    expect(parseGatewayModelId(id)).toEqual({
      providerId: 'vertexai',
      apiModelId: 'publishers/google:gemini-2.5-pro'
    })
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
    expect(parseGatewayModelId(id)).toEqual({ providerId: 'team/models/west', apiModelId: 'gemini-2.5-pro' })
  })

  it('round-trips Antigravity content containing legacy separators', () => {
    const path = formatAntigravityGatewayModelPath('team/models/west', 'models/gemini:flash@cherry')
    expect(path).toMatch(/^cherry-gw-v1\/models\/[A-Za-z0-9_-]+$/)
    expect(parseAntigravityGatewayModelPath(path)).toEqual({
      providerId: 'team/models/west',
      apiModelId: 'models/gemini:flash@cherry'
    })
  })

  it('keeps a real @cherry model distinct from the Gemini gateway wrapper', () => {
    const wrapped = formatGeminiGatewayModelId('provider-a', 'model')
    expect(formatGatewayModelId('provider-a', 'model@cherry')).not.toBe(wrapped)
    expect(parseGeminiGatewayModelId(wrapped)).toEqual({ providerId: 'provider-a', apiModelId: 'model' })
  })

  it('does not treat ordinary generic ids as tagged CLI addresses', () => {
    expect(parseGeminiGatewayModelId('provider-a:model@cherry')).toBeUndefined()
    expect(parseAntigravityGatewayModelPath('provider-a/models/model')).toBeUndefined()
  })

  it('rejects a malformed reserved tag instead of falling back to legacy parsing', () => {
    expect(() => parseGeminiGatewayModelId('cherry-gw-v1.not-base64@cherry')).toThrow(/Invalid Gemini gateway model/)
    expect(() => parseAntigravityGatewayModelPath('cherry-gw-v1/models/not-base64')).toThrow(
      /Invalid Antigravity gateway model/
    )
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
