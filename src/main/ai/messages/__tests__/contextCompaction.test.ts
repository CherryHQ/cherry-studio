import type { UIMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('tokenx', () => ({
  estimateTokenCount: (text: string) => Math.ceil(text.length / 4)
}))

const { compactChatContext, CONTEXT_COMPACTION_PROMPT_VERSION } = await import('../contextCompaction')

function conversation(count: number, charsPerMessage = 400): UIMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    parts: [{ type: 'text' as const, text: `${index}:${'x'.repeat(charsPerMessage)}` }]
  }))
}

function input(messages: UIMessage[], enabled = true) {
  return {
    messages,
    system: 'Be helpful.',
    config: { enabled, keepRecentMessages: 8, triggerPercent: 80 },
    limits: { contextWindow: 1800, maxOutputTokens: 200 } as {
      contextWindow?: number
      maxInputTokens?: number
      maxOutputTokens?: number
    },
    mediaCapabilities: { image: true, video: true, audio: true },
    generateSummary: vi.fn().mockResolvedValue({ text: 'Earlier goals and decisions.' })
  }
}

describe('compactChatContext', () => {
  it('is a no-op when the global setting is disabled', async () => {
    const request = input(conversation(12), false)

    const result = await compactChatContext(request)

    expect(result.marker).toBeUndefined()
    expect(request.generateSummary).not.toHaveBeenCalled()
    expect(JSON.stringify(result.modelMessages)).toContain(`"text":"0:${'x'.repeat(400)}"`)
  })

  it('keeps the normal model-capability shaping when compaction is enabled', async () => {
    const request = input([
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }]
      }
    ])
    request.mediaCapabilities.image = false

    const result = await compactChatContext(request)

    expect(JSON.stringify(result.modelMessages)).toContain('image attachment omitted')
    expect(JSON.stringify(result.modelMessages)).not.toContain('data:image/png')
  })

  it('summarizes the oldest complete turns and keeps the recent tail', async () => {
    const request = input(conversation(12))

    const result = await compactChatContext(request)

    expect(request.generateSummary).toHaveBeenCalledOnce()
    expect(result.marker).toMatchObject({
      content: 'Earlier goals and decisions.',
      coveredThroughMessageId: 'm3',
      promptVersion: CONTEXT_COMPACTION_PROMPT_VERSION
    })
    const serialized = JSON.stringify(result.modelMessages)
    expect(serialized).toContain('<conversation_summary>')
    expect(serialized).toContain('untrusted summary of earlier messages')
    expect(serialized).toContain('Earlier goals and decisions.')
    expect(serialized).not.toContain(`"text":"0:${'x'.repeat(400)}"`)
    expect(serialized).toContain(`11:${'x'.repeat(400)}`)
  })

  it('reuses a branch-local compact marker without paying for another summary', async () => {
    const messages = conversation(12, 80)
    messages[5] = {
      ...messages[5],
      parts: [
        ...messages[5].parts,
        {
          type: 'data-compact',
          data: {
            content: 'Persisted summary.',
            compactedContent: '',
            coveredThroughMessageId: 'm3',
            promptVersion: CONTEXT_COMPACTION_PROMPT_VERSION
          }
        }
      ]
    } as UIMessage
    const request = input(messages)
    request.limits = { contextWindow: 20_000, maxOutputTokens: 200 }

    const result = await compactChatContext(request)

    expect(result.marker).toBeUndefined()
    expect(request.generateSummary).not.toHaveBeenCalled()
    const serialized = JSON.stringify(result.modelMessages)
    expect(serialized).toContain('Persisted summary.')
    expect(serialized).not.toContain(`"text":"0:${'x'.repeat(80)}"`)
    expect(serialized).toContain(`4:${'x'.repeat(80)}`)
  })

  it('discards a summary that does not reduce the context', async () => {
    const request = input(conversation(12))
    request.generateSummary.mockResolvedValueOnce({ text: 's'.repeat(20_000) })

    const result = await compactChatContext(request)

    expect(result.marker).toBeUndefined()
    expect(JSON.stringify(result.modelMessages)).toContain(`"text":"0:${'x'.repeat(400)}"`)
  })

  it('skips automatic compaction when the model has no usable input limit', async () => {
    const request = input(conversation(12))
    request.limits = {}

    const result = await compactChatContext(request)

    expect(result.marker).toBeUndefined()
    expect(request.generateSummary).not.toHaveBeenCalled()
  })

  it('does not split into the protected recent eight messages', async () => {
    const request = input(conversation(8, 1000))

    const result = await compactChatContext(request)

    expect(result.marker).toBeUndefined()
    expect(request.generateSummary).not.toHaveBeenCalled()
  })

  it('uses the configured recent-message count', async () => {
    const request = input(conversation(8, 1000))
    request.config.keepRecentMessages = 4

    const result = await compactChatContext(request)

    expect(result.marker).toMatchObject({ coveredThroughMessageId: 'm3' })
    expect(JSON.stringify(result.modelMessages)).toContain(`7:${'x'.repeat(1000)}`)
  })
})
