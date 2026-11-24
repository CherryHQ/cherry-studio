import { describe, expect, it, vi } from 'vitest'

import { buildHandoff, HANDOFF_HEADINGS, readHandoffSource, splitHandoffSource, validateHandoff } from '../handoffNote'
import { readAllConversationMessages } from '../readConversation'
vi.mock('../readConversation', () => ({ readAllConversationMessages: vi.fn() }))
const note = HANDOFF_HEADINGS.map((heading) => `## ${heading}\nEvidence or unknown.`).join('\n\n')
describe('portable handoff', () => {
  it('reads all stored selected-branch messages and omits reasoning and attachment locators', () => {
    vi.mocked(readAllConversationMessages).mockReturnValue({
      source: 'topic',
      sessionId: 'topic',
      messages: [
        {
          role: 'user',
          data: {
            parts: [
              { type: 'text', text: 'early constraint' },
              { type: 'reasoning', text: 'private thought' },
              { type: 'file', url: 'file:///private/raw', filename: '/private/evidence.md', mediaType: 'text/markdown' }
            ]
          }
        }
      ]
    } as never)
    const result = readHandoffSource('topic')
    expect(readAllConversationMessages).toHaveBeenCalledWith({ sessionId: 'topic' })
    expect(result).toContain('early constraint')
    expect(result).toContain('evidence.md')
    expect(result).not.toContain('private thought')
    expect(result).not.toContain('file:///private/raw')
  })
  it('rejects empty history', () => {
    vi.mocked(readAllConversationMessages).mockReturnValue({ messages: [] } as never)
    expect(() => readHandoffSource('empty')).toThrow('no messages')
  })
  it('requires all six ordered sections and rejects malformed output', () => {
    expect(validateHandoff(note)).toBe(note)
    expect(() => validateHandoff('## Goals\nIncomplete')).toThrow('required sections')
    expect(() =>
      validateHandoff(
        HANDOFF_HEADINGS.toReversed()
          .map((h) => `## ${h}`)
          .join('\n')
      )
    ).toThrow()
  })
  it('splits UTF-8 without losing any source or splitting surrogate pairs', () => {
    const source = '早期🙂'.repeat(3000)
    const chunks = splitHandoffSource(source, 10_000)
    expect(chunks.join('')).toBe(source)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 1808)).toBe(true)
    expect(() => splitHandoffSource(source, 4096)).toThrow('context window')
  })
  it('extracts each chronological source segment before reducing into a portable note', async () => {
    const generate = vi.fn(async (_prompt: string) => note)
    expect(
      await buildHandoff('start ' + 'x'.repeat(9000) + ' final', 12_000, generate, new AbortController().signal)
    ).toBe(note)
    expect(generate).toHaveBeenCalledTimes(4)
    expect(generate.mock.calls[0][0]).toContain('start ')
    expect(generate.mock.calls[2][0]).toContain(' final')
    expect(generate.mock.calls[3][0]).toContain('Chronological segment 1')
  })
  it('cancels between requests and stops on errors without persisting anything', async () => {
    const controller = new AbortController()
    const generate = vi.fn(async () => {
      controller.abort()
      return note
    })
    await expect(buildHandoff('x'.repeat(9000), 12_000, generate, controller.signal)).rejects.toThrow()
    expect(generate).toHaveBeenCalledTimes(1)
    await expect(
      buildHandoff(
        'hello',
        12_000,
        async () => {
          throw new Error('provider failed')
        },
        new AbortController().signal
      )
    ).rejects.toThrow('provider failed')
  })
  it('fails visibly rather than looping if the model does not reduce', async () => {
    const large = HANDOFF_HEADINGS.map((h) => `## ${h}\n${'x'.repeat(800)}`).join('\n')
    await expect(
      buildHandoff('x'.repeat(9000), 12_000, async () => large, new AbortController().signal)
    ).rejects.toThrow('could not be reduced')
  })
})
