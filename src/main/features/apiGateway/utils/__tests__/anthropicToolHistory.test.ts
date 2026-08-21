import type {
  MessageParam,
  ServerToolUseBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam
} from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'

import { normalizeAnthropicToolHistory } from '../anthropicToolHistory'

function toolUse(id: string, input: unknown = { path: '/tmp/a' }): ToolUseBlockParam {
  return { type: 'tool_use', id, name: 'read_file', input }
}

function toolResult(id: string, content: string, isError = false): ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content, is_error: isError }
}

describe('normalizeAnthropicToolHistory', () => {
  it('keeps valid parallel calls and out-of-order results by reference', () => {
    const messages: MessageParam[] = [
      { role: 'assistant', content: [toolUse('c1'), toolUse('c2', { path: '/tmp/b' })] },
      { role: 'user', content: [toolResult('c2', 'B'), toolResult('c1', 'A')] }
    ]

    const result = normalizeAnthropicToolHistory(messages)

    expect(result).toEqual({ status: 'unchanged', messages })
    if (result.status === 'unchanged') expect(result.messages).toBe(messages)
  })

  it('ignores string content and server-tool blocks', () => {
    const serverTool: ServerToolUseBlockParam = {
      type: 'server_tool_use',
      id: 'server-1',
      name: 'web_search',
      input: { query: 'Cherry Studio' }
    }
    const messages: MessageParam[] = [
      { role: 'user', content: 'Run the server tool' },
      { role: 'assistant', content: [serverTool] },
      { role: 'assistant', content: [structuredClone(serverTool)] }
    ]

    const result = normalizeAnthropicToolHistory(messages)

    expect(result).toEqual({ status: 'unchanged', messages })
    if (result.status === 'unchanged') expect(result.messages).toBe(messages)
  })

  it('removes identical calls and results without mutating input or cloning unchanged messages', () => {
    const call = toolUse('c1')
    const output = toolResult('c1', 'A')
    const unchangedMessage: MessageParam = { role: 'user', content: 'Keep this message' }
    const messages: MessageParam[] = [
      { role: 'assistant', content: [call, structuredClone(call)] },
      unchangedMessage,
      { role: 'user', content: [output, structuredClone(output)] }
    ]
    const snapshot = structuredClone(messages)

    const result = normalizeAnthropicToolHistory(messages)

    expect(result.status).toBe('repaired')
    if (result.status !== 'repaired') throw new Error('expected repaired history')
    expect(result.duplicateToolUseCount).toBe(1)
    expect(result.duplicateToolResultCount).toBe(1)
    expect(result.messages).not.toBe(messages)
    expect(result.messages[0]).not.toBe(messages[0])
    expect(result.messages[0].content).toEqual([call])
    expect(result.messages[1]).toBe(unchangedMessage)
    expect(result.messages[2]).not.toBe(messages[2])
    expect(result.messages[2].content).toEqual([output])
    expect(messages).toEqual(snapshot)
  })

  it('removes only the later occurrence when one block object is reused by reference', () => {
    const call = toolUse('c1')
    const output = toolResult('c1', 'A')
    const messages: MessageParam[] = [
      { role: 'assistant', content: [call, call] },
      { role: 'user', content: [output, output] }
    ]

    const result = normalizeAnthropicToolHistory(messages)

    expect(result.status).toBe('repaired')
    if (result.status !== 'repaired') throw new Error('expected repaired history')
    expect(result.messages[0].content).toEqual([call])
    expect(result.messages[1].content).toEqual([output])
    expect(result.duplicateToolUseCount).toBe(1)
    expect(result.duplicateToolResultCount).toBe(1)
  })

  it('rejects different calls that reuse one id and reports both locations', () => {
    const messages: MessageParam[] = [
      { role: 'assistant', content: [toolUse('c1'), toolUse('c1', { path: '/tmp/b' })] }
    ]

    expect(normalizeAnthropicToolHistory(messages)).toEqual({
      status: 'conflict',
      toolUseId: 'c1',
      reason: 'different-call',
      firstLocation: { messageIndex: 0, contentIndex: 0 },
      duplicateLocation: { messageIndex: 0, contentIndex: 1 }
    })
  })

  it('uses the entire tool-use block, including optional metadata, for equality', () => {
    const withCacheControl: ToolUseBlockParam = {
      ...toolUse('c1'),
      cache_control: { type: 'ephemeral' }
    }
    const messages: MessageParam[] = [{ role: 'assistant', content: [withCacheControl, toolUse('c1')] }]

    expect(normalizeAnthropicToolHistory(messages)).toMatchObject({
      status: 'conflict',
      toolUseId: 'c1',
      reason: 'different-call'
    })
  })

  it('rejects an id reused across assistant turns even when blocks are identical', () => {
    const call = toolUse('c1')
    const messages: MessageParam[] = [
      { role: 'assistant', content: [call] },
      { role: 'user', content: [toolResult('c1', 'A')] },
      { role: 'assistant', content: [structuredClone(call)] }
    ]

    expect(normalizeAnthropicToolHistory(messages)).toEqual({
      status: 'conflict',
      toolUseId: 'c1',
      reason: 'cross-turn-reuse',
      firstLocation: { messageIndex: 0, contentIndex: 0 },
      duplicateLocation: { messageIndex: 2, contentIndex: 0 }
    })
  })

  it('rejects different results that reuse one id and reports both locations', () => {
    const messages: MessageParam[] = [
      { role: 'assistant', content: [toolUse('c1')] },
      { role: 'user', content: [toolResult('c1', 'A')] },
      { role: 'user', content: [toolResult('c1', 'B')] }
    ]

    expect(normalizeAnthropicToolHistory(messages)).toEqual({
      status: 'conflict',
      toolUseId: 'c1',
      reason: 'different-result',
      firstLocation: { messageIndex: 1, contentIndex: 0 },
      duplicateLocation: { messageIndex: 2, contentIndex: 0 }
    })
  })
})
