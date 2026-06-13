import type { ReasoningUIPart, TextUIPart } from 'ai'
import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '../message'
import {
  CherryReasoningMetaSchema,
  CherryTextMetaSchema,
  CherryToolMetaSchema,
  readCherryMeta,
  withCherryMeta
} from '../uiParts'

// ============================================================================
// Schema sanity — declared shape matches expectation
// ============================================================================

describe('CherryTextMetaSchema', () => {
  it('accepts references as array of anything', () => {
    expect(CherryTextMetaSchema.safeParse({ references: [{ category: 'citation' }] }).success).toBe(true)
    expect(CherryTextMetaSchema.safeParse({}).success).toBe(true)
  })
  it('rejects references that is not an array', () => {
    expect(CherryTextMetaSchema.safeParse({ references: 'not-an-array' }).success).toBe(false)
  })
})

describe('CherryReasoningMetaSchema', () => {
  it('accepts thinkingMs as number', () => {
    expect(CherryReasoningMetaSchema.safeParse({ thinkingMs: 1234 }).success).toBe(true)
  })
  it('accepts startedAt as number', () => {
    expect(CherryReasoningMetaSchema.safeParse({ startedAt: 1780913860106 }).success).toBe(true)
  })
  it('rejects thinkingMs that is not a number', () => {
    expect(CherryReasoningMetaSchema.safeParse({ thinkingMs: '1234' }).success).toBe(false)
  })
})

describe('CherryToolMetaSchema', () => {
  it('accepts transport/toolName/tool', () => {
    const ok = CherryToolMetaSchema.safeParse({
      transport: 'claude-agent',
      toolName: 'web_search',
      tool: { serverId: 's1', serverName: 'search', type: 'mcp' }
    })
    expect(ok.success).toBe(true)
  })
  it('rejects tool.type outside the enum', () => {
    const bad = CherryToolMetaSchema.safeParse({ tool: { type: 'pluggable' } })
    expect(bad.success).toBe(false)
  })
})

// ============================================================================
// readCherryMeta — runtime validation + narrowing
// ============================================================================

describe('readCherryMeta', () => {
  it('reads CherryTextMeta from a TextUIPart with references', () => {
    const part: TextUIPart = {
      type: 'text',
      text: 'hi',
      providerMetadata: { cherry: { references: [{ category: 'citation' }] } }
    }
    const meta = readCherryMeta(part)
    expect(meta?.references).toEqual([{ category: 'citation' }])
  })

  it('reads CherryReasoningMeta from a ReasoningUIPart with thinking metadata', () => {
    const part: ReasoningUIPart = {
      type: 'reasoning',
      text: 'thinking...',
      providerMetadata: { cherry: { thinkingMs: 5000, startedAt: 1780913860106 } }
    }
    const meta = readCherryMeta(part)
    expect(meta?.thinkingMs).toBe(5000)
    expect(meta?.startedAt).toBe(1780913860106)
  })

  it('reads CherryToolMeta from a tool-foo part with transport and tool', () => {
    const part = {
      type: 'tool-fetch_url',
      toolCallId: 'tc1',
      providerMetadata: {
        cherry: { transport: 'claude-agent', tool: { serverId: 's1', type: 'mcp' as const } }
      }
    } as unknown as CherryMessagePart
    const meta = readCherryMeta(part)
    expect(meta).toEqual({
      transport: 'claude-agent',
      tool: { serverId: 's1', type: 'mcp' }
    })
  })

  it('reads CherryToolMeta from a dynamic-tool part', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'x',
      toolCallId: 'tc2',
      providerMetadata: { cherry: { transport: 'claude-agent' } }
    } as unknown as Extract<CherryMessagePart, { type: 'dynamic-tool' }>
    expect(readCherryMeta(part)?.transport).toBe('claude-agent')
  })

  it('returns undefined when providerMetadata is missing', () => {
    const part: TextUIPart = { type: 'text', text: '' }
    expect(readCherryMeta(part)).toBeUndefined()
  })

  it('returns undefined when cherry is missing', () => {
    const part: TextUIPart = { type: 'text', text: '', providerMetadata: {} }
    expect(readCherryMeta(part)).toBeUndefined()
  })

  it('returns undefined when cherry is not an object', () => {
    const part = {
      type: 'text',
      text: '',
      providerMetadata: { cherry: 'oops' }
    } as unknown as TextUIPart
    expect(readCherryMeta(part)).toBeUndefined()
  })

  it('returns undefined for a part type without a registered schema', () => {
    const part = {
      type: 'data-translation',
      data: { content: 'x', targetLanguage: 'en' },
      providerMetadata: { cherry: { references: [] } }
    } as unknown as CherryMessagePart
    expect(readCherryMeta(part)).toBeUndefined()
  })

  it('returns undefined when references is the wrong shape', () => {
    const part = {
      type: 'text',
      text: '',
      providerMetadata: { cherry: { references: 'oops' } }
    } as unknown as TextUIPart
    expect(readCherryMeta(part)).toBeUndefined()
  })

  it('returns undefined when thinkingMs is the wrong shape', () => {
    const part = {
      type: 'reasoning',
      text: '',
      providerMetadata: { cherry: { thinkingMs: 'oops' } }
    } as unknown as ReasoningUIPart
    expect(readCherryMeta(part)).toBeUndefined()
  })
})

// ============================================================================
// withCherryMeta — typed write boundary
// ============================================================================

describe('withCherryMeta', () => {
  it('writes references onto a TextUIPart', () => {
    const part: TextUIPart = { type: 'text', text: '' }
    const next = withCherryMeta(part, { references: [{ url: 'https://ex.com' }] })
    expect(next.providerMetadata?.cherry).toEqual({ references: [{ url: 'https://ex.com' }] })
  })

  it('preserves existing cherry fields when merging', () => {
    const part: TextUIPart = {
      type: 'text',
      text: '',
      providerMetadata: { cherry: { references: [{ a: 1 }] } }
    }
    const next = withCherryMeta(part, { references: [{ b: 2 }] })
    // shallow merge: new patch overwrites the same key
    expect(next.providerMetadata?.cherry).toEqual({ references: [{ b: 2 }] })
  })

  it('writes thinking metadata onto a ReasoningUIPart', () => {
    const part: ReasoningUIPart = { type: 'reasoning', text: '' }
    const next = withCherryMeta(part, { thinkingMs: 1234, startedAt: 1780913860106 })
    expect(next.providerMetadata?.cherry).toEqual({ thinkingMs: 1234, startedAt: 1780913860106 })
  })

  // ── Compile-time negatives — `tsc --noEmit` enforces these. ──────────
  it('rejects writing thinkingMs to TextUIPart at compile time', () => {
    const part: TextUIPart = { type: 'text', text: '' }
    // @ts-expect-error thinkingMs is not on CherryTextMeta
    withCherryMeta(part, { thinkingMs: 1 })
    expect(true).toBe(true)
  })

  it('rejects writing references to ReasoningUIPart at compile time', () => {
    const part: ReasoningUIPart = { type: 'reasoning', text: '' }
    // @ts-expect-error references is not on CherryReasoningMeta
    withCherryMeta(part, { references: [] })
    expect(true).toBe(true)
  })

  it('rejects writing transport to TextUIPart at compile time', () => {
    const part: TextUIPart = { type: 'text', text: '' }
    // @ts-expect-error transport is not on CherryTextMeta
    withCherryMeta(part, { transport: 'x' })
    expect(true).toBe(true)
  })
})
