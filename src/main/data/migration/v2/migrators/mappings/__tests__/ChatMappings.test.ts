import { describe, expect, it } from 'vitest'

import {
  buildMessageTree,
  extractCitationReferences,
  mergeStats,
  normalizeStatus,
  type OldBlock,
  type OldCitationBlock,
  type OldMainTextBlock as OldMainTextBlockType,
  type OldMessage,
  transformMessage
} from '../ChatMappings'

/** Helper: create a minimal OldMessage stub */
function msg(id: string, role: 'user' | 'assistant' = 'assistant', extra: Partial<OldMessage> = {}): OldMessage {
  return {
    id,
    role,
    assistantId: 'a1',
    topicId: 't1',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    blocks: ['block-1'],
    ...extra
  }
}

describe('buildMessageTree', () => {
  it('returns empty map for empty input', () => {
    expect(buildMessageTree([])).toEqual(new Map())
  })

  it('builds a linear chain for sequential messages', () => {
    const messages = [msg('u1', 'user'), msg('a1'), msg('u2', 'user'), msg('a2')]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    expect(tree.get('a1')).toEqual({ parentId: 'u1', siblingsGroupId: 0 })
    expect(tree.get('u2')).toEqual({ parentId: 'a1', siblingsGroupId: 0 })
    expect(tree.get('a2')).toEqual({ parentId: 'u2', siblingsGroupId: 0 })
  })

  it('groups multi-model responses under the user message', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' })
    ]

    const tree = buildMessageTree(messages)

    expect(tree.get('u1')).toEqual({ parentId: null, siblingsGroupId: 0 })
    // Both responses share the same parent (user message) and siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('links user message after multi-model group to foldSelected response', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      msg('u2', 'user')
    ]

    const tree = buildMessageTree(messages)

    // u2 should link to the foldSelected response (a1)
    expect(tree.get('u2')!.parentId).toBe('a1')
  })

  // --- The fix: askId pointing to a deleted user message ---

  it('falls back to previousMessageId when askId points to deleted message', () => {
    // User message 'u1' was deleted, but assistant responses still have askId: 'u1'
    const messages = [msg('a1', 'assistant', { askId: 'u1' }), msg('a2', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // askId 'u1' doesn't exist in messages, siblings share a common fallback parent
    expect(tree.get('a1')!.parentId).toBeNull() // first message, no previous → null
    expect(tree.get('a2')!.parentId).toBeNull() // same shared parent as a1
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('falls back to previousMessageId when askId points to deleted message (with prior context)', () => {
    // There's a prior message, then the deleted user message's responses
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted-user-msg' }),
      msg('a2', 'assistant', { askId: 'deleted-user-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as common parent and keep siblingsGroupId
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a1')!.siblingsGroupId).toBe(tree.get('a2')!.siblingsGroupId)
  })

  it('handles mixed: some askIds valid, some pointing to deleted messages', () => {
    const messages = [
      msg('u1', 'user'),
      // Valid multi-model group
      msg('a1', 'assistant', { askId: 'u1', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'u1' }),
      // Orphaned group (user message deleted)
      msg('a3', 'assistant', { askId: 'deleted-msg' }),
      msg('a4', 'assistant', { askId: 'deleted-msg' })
    ]

    const tree = buildMessageTree(messages)

    // Valid group: siblings under u1
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBeGreaterThan(0)

    // Orphaned group: siblings share common parent (a2, last before group) and keep groupId
    expect(tree.get('a3')!.parentId).toBe('a2')
    expect(tree.get('a4')!.parentId).toBe('a2')
    expect(tree.get('a3')!.siblingsGroupId).toBeGreaterThan(0)
    expect(tree.get('a3')!.siblingsGroupId).toBe(tree.get('a4')!.siblingsGroupId)
  })

  it('does not form a group for single askId reference even when valid', () => {
    // Only one response with askId — not a multi-model group (count == 1)
    const messages = [msg('u1', 'user'), msg('a1', 'assistant', { askId: 'u1' })]

    const tree = buildMessageTree(messages)

    // Single askId doesn't create a group, falls through to sequential
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a1')!.siblingsGroupId).toBe(0)
  })

  it('links user message after multi-model group with no foldSelected to last group member', () => {
    const messages = [
      msg('u1', 'user'),
      msg('a1', 'assistant', { askId: 'u1' }),
      msg('a2', 'assistant', { askId: 'u1' }),
      msg('u2', 'user')
    ]

    const tree = buildMessageTree(messages)

    // Both responses are siblings under u1
    expect(tree.get('a1')!.parentId).toBe('u1')
    expect(tree.get('a2')!.parentId).toBe('u1')
    // u2 should link to the last group member (a2), NOT to u1
    expect(tree.get('u2')!.parentId).toBe('a2')
  })

  it('links user message after orphaned foldSelected group to the selected response', () => {
    const messages = [
      msg('prev', 'assistant'),
      msg('a1', 'assistant', { askId: 'deleted', foldSelected: true }),
      msg('a2', 'assistant', { askId: 'deleted' }),
      msg('u1', 'user')
    ]

    const tree = buildMessageTree(messages)

    // Orphaned siblings share 'prev' as parent
    expect(tree.get('a1')!.parentId).toBe('prev')
    expect(tree.get('a2')!.parentId).toBe('prev')
    // u1 should link to foldSelected response a1
    expect(tree.get('u1')!.parentId).toBe('a1')
  })
})

// ============================================================================
// transformMessage
// ============================================================================

function mainTextBlock(id: string, messageId: string, content: string): OldMainTextBlockType {
  return {
    id,
    messageId,
    type: 'main_text',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success',
    content
  }
}

describe('transformMessage', () => {
  it('builds UniqueModelId from model object', () => {
    const oldMsg: OldMessage = {
      ...msg('m1', 'assistant'),
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', group: 'default' }
    }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBe('openai::gpt-4')
  })

  it('falls back to raw modelId when model object is missing', () => {
    const oldMsg: OldMessage = { ...msg('m1', 'assistant'), modelId: 'raw-model-id' }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBe('raw-model-id')
  })

  it('returns null modelId when both model and modelId are missing', () => {
    const oldMsg: OldMessage = msg('m1', 'assistant')
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelId).toBeNull()
  })

  it('builds modelSnapshot from model object', () => {
    const oldMsg: OldMessage = {
      ...msg('m1', 'assistant'),
      model: { id: 'gpt-4', name: 'GPT-4', provider: 'openai', group: 'chatgpt' }
    }
    const blocks: OldBlock[] = [mainTextBlock('b1', 'm1', 'hello')]

    const result = transformMessage(oldMsg, null, 0, blocks, 'topic-1')

    expect(result.modelSnapshot).toEqual({
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      group: 'chatgpt'
    })
  })

  it('returns null modelSnapshot when model is missing', () => {
    const result = transformMessage(msg('m1', 'assistant'), null, 0, [mainTextBlock('b1', 'm1', 'x')], 't1')
    expect(result.modelSnapshot).toBeNull()
  })

  it('merges citations from CitationBlock into MainTextBlock.references', () => {
    const blocks: OldBlock[] = [
      mainTextBlock('b1', 'm1', 'hello'),
      {
        id: 'c1',
        messageId: 'm1',
        type: 'citation',
        createdAt: '2025-01-01T00:00:00.000Z',
        status: 'success',
        response: { results: [{ title: 'Test', url: 'https://example.com' }], source: 'google' }
      } as OldCitationBlock
    ]

    const result = transformMessage(msg('m1', 'assistant'), null, 0, blocks, 't1')

    // Citation block should not appear as a separate data block
    expect(result.data.blocks).toHaveLength(1)
    expect(result.data.blocks[0].type).toBe('main_text')
    // Citation should be merged into MainTextBlock.references
    expect((result.data.blocks[0] as any).references).toHaveLength(1)
    expect((result.data.blocks[0] as any).references[0].citationType).toBe('web')
  })
})

// ============================================================================
// normalizeStatus
// ============================================================================

describe('normalizeStatus', () => {
  it('maps success/paused directly', () => {
    expect(normalizeStatus('success')).toBe('success')
    expect(normalizeStatus('paused')).toBe('paused')
  })

  it('maps transient states to error', () => {
    expect(normalizeStatus('sending')).toBe('error')
    expect(normalizeStatus('pending')).toBe('error')
    expect(normalizeStatus('searching')).toBe('error')
    expect(normalizeStatus('processing')).toBe('error')
    expect(normalizeStatus('error')).toBe('error')
  })
})

// ============================================================================
// mergeStats
// ============================================================================

describe('mergeStats', () => {
  it('returns null when both usage and metrics are missing', () => {
    expect(mergeStats()).toBeNull()
    expect(mergeStats(undefined, undefined)).toBeNull()
  })

  it('merges usage tokens', () => {
    const stats = mergeStats({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 })
    expect(stats).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 })
  })

  it('merges metrics timing', () => {
    const stats = mergeStats(undefined, { time_first_token_millsec: 100, time_completion_millsec: 500 })
    expect(stats).toEqual({ timeFirstTokenMs: 100, timeCompletionMs: 500 })
  })

  it('merges both usage and metrics', () => {
    const stats = mergeStats({ prompt_tokens: 5 }, { time_thinking_millsec: 200 })
    expect(stats).toEqual({ promptTokens: 5, timeThinkingMs: 200 })
  })
})

// ============================================================================
// extractCitationReferences
// ============================================================================

describe('extractCitationReferences', () => {
  const baseCitationBlock: OldCitationBlock = {
    id: 'c1',
    messageId: 'm1',
    type: 'citation',
    createdAt: '2025-01-01T00:00:00.000Z',
    status: 'success'
  }

  it('extracts web citations with results and source preserved', () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      response: { results: [{ title: 'Result', url: 'https://x.com', snippet: 'text' }], source: 'google' }
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('web')
    expect(ref.content.results).toEqual([{ title: 'Result', url: 'https://x.com', snippet: 'text' }])
    expect(ref.content.source).toBe('google')
  })

  it('extracts knowledge citations with content mapped', () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      knowledge: [{ id: 'k1', content: 'text', sourceUrl: 'https://doc.com', type: 'pdf' } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('knowledge')
    expect(ref.content).toHaveLength(1)
    expect(ref.content[0]).toMatchObject({ id: 'k1', content: 'text', sourceUrl: 'https://doc.com', type: 'pdf' })
  })

  it('extracts memory citations with fields mapped', () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      memories: [{ id: 'mem1', memory: 'user likes coffee', hash: 'abc', score: 0.9 } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(1)
    const ref = refs[0] as any
    expect(ref.citationType).toBe('memory')
    expect(ref.content).toHaveLength(1)
    expect(ref.content[0]).toMatchObject({ id: 'mem1', memory: 'user likes coffee', hash: 'abc', score: 0.9 })
  })

  it('extracts all citation types from a single block', () => {
    const block: OldCitationBlock = {
      ...baseCitationBlock,
      response: { results: [{ title: 'T', url: 'https://x.com' }], source: 'bing' },
      knowledge: [{ id: 'k1', content: 'doc' } as any],
      memories: [{ id: 'm1', memory: 'fact' } as any]
    }
    const refs = extractCitationReferences(block)
    expect(refs).toHaveLength(3)
    const types = refs.map((r: any) => r.citationType)
    expect(types).toEqual(['web', 'knowledge', 'memory'])
  })

  it('returns empty array when no citations exist', () => {
    expect(extractCitationReferences(baseCitationBlock)).toEqual([])
  })
})
