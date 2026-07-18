import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { describe, expect, it } from 'vitest'

/** The gateway proxy's parse side (proxyStream.ts): split on the FIRST ':'. */
function parseByFirstColon(gatewayModelId: string): { providerId: string; modelId: string } {
  const sepIdx = gatewayModelId.indexOf(':')
  return { providerId: gatewayModelId.slice(0, sepIdx), modelId: gatewayModelId.slice(sepIdx + 1) }
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
})
