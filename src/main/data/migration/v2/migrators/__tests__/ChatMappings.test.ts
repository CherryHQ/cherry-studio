import { describe, expect, it } from 'vitest'

import { type OldBlock, transformSingleBlockToPart } from '../mappings/ChatMappings'

/**
 * v1 ErrorMessageBlock → v2 `data-error` part. The migrator must preserve the full v1
 * serialized error (statusCode, finishReason, i18nKey, providerId, ...), not just
 * name/message — otherwise v2's classifyError / ErrorBlock / ErrorDetailModal lose the
 * fields they rely on and every migrated error renders as 'unknown'. See #16083.
 */
describe('transformSingleBlockToPart — error block (#16083)', () => {
  it('preserves the full serialized error, not just name/message', async () => {
    const block = {
      id: 'b1',
      messageId: 'm1',
      type: 'error',
      error: {
        name: 'AI_APICallError',
        message: 'Request failed',
        stack: 'Error: Request failed\n  at ...',
        statusCode: 403,
        status: 403,
        finishReason: 'content-filter',
        i18nKey: 'chat.no_api_key',
        providerId: 'openai',
        responseBody: '{"error":"forbidden"}'
      }
    } as unknown as OldBlock

    const { part, extraParts, citations } = await transformSingleBlockToPart(block)

    expect(extraParts).toBeNull()
    expect(citations).toBeNull()
    expect(part).toMatchObject({
      type: 'data-error',
      data: {
        name: 'AI_APICallError',
        message: 'Request failed',
        stack: 'Error: Request failed\n  at ...',
        statusCode: 403,
        status: 403,
        finishReason: 'content-filter',
        i18nKey: 'chat.no_api_key',
        providerId: 'openai',
        responseBody: '{"error":"forbidden"}'
      }
    })
  })

  it('defaults name/message to null when the v1 error is absent', async () => {
    const block = { id: 'b1', messageId: 'm1', type: 'error' } as unknown as OldBlock

    const { part } = await transformSingleBlockToPart(block)

    expect(part).toEqual({ type: 'data-error', data: { name: null, message: null } })
  })
})
