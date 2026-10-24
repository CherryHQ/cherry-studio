import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { historyOf, keysOf } from '../src/behavior/history'

const usage = {
  input: 3,
  output: 2,
  cacheRead: 1,
  cacheWrite: 0,
  totalTokens: 6,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 }
}

describe('behavior history', () => {
  // Catches a projection that reads a marker's data from `content` instead of `details`, loses a record's key, a
  // reply's cost or a person's text, keys a call and its result apart from the gate's `<sessionId>:<toolCallId>`, or
  // drops a blocked call's reason from its result: keysSeen would miss writes, usage would bill nothing, approvals could
  // not be matched to calls and the gate rules could not find why a call was blocked.
  it('projects native entries into the history the package decides on', () => {
    const manager = SessionManager.inMemory('/tmp/behavior-history')
    const thread = runtimeId<'thread'>(manager.getSessionId())
    const user = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'go' }], timestamp: 1 })
    manager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'calling' },
        { type: 'toolCall', id: 'call-1', name: 'echo', arguments: { n: 1 } },
        { type: 'toolCall', id: 'call-2', name: 'echo', arguments: { n: 2 } }
      ],
      api: 'contract',
      provider: 'contract',
      model: 'model',
      usage,
      stopReason: 'toolUse',
      timestamp: 2
    })
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'echo',
      content: [{ type: 'text', text: 'Tool call blocked: plan mode' }],
      isError: true,
      timestamp: 3
    })
    manager.appendMessage({
      role: 'toolResult',
      toolCallId: 'call-2',
      toolName: 'echo',
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
      timestamp: 4
    })
    manager.appendCustomMessageEntry('cherry.subagent-status', 'Two subagents still run.', false, { key: 'k-marker' })
    manager.appendCustomEntry('cherry.goal-notice', { text: 'noted', level: 'info', key: 'k-record' })
    manager.appendCustomEntry('cherry.tool-loadout', { activated: [] })
    manager.appendCompaction('summary', user, 10)

    const history = historyOf(manager.getBranch(), thread)
    expect(history.map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
      'tool-result',
      'tool-result',
      'marker',
      'record',
      'compaction'
    ])
    expect(history[0]).toMatchObject({ text: 'go' })
    expect(history[1]).toMatchObject({
      text: 'calling',
      toolCalls: [
        { callId: 'call-1', callKey: `${thread}:call-1`, name: 'echo', args: { n: 1 } },
        { callId: 'call-2', callKey: `${thread}:call-2`, name: 'echo', args: { n: 2 } }
      ],
      stop: 'toolUse',
      usage: { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 6, costUsd: 0.5 }
    })
    expect(history[2]).toMatchObject({
      callId: 'call-1',
      callKey: `${thread}:call-1`,
      isError: true,
      text: 'Tool call blocked: plan mode'
    })
    expect(history[4]).toMatchObject({
      key: 'k-marker',
      marker: { type: 'subagent-status' },
      text: 'Two subagents still run.'
    })
    expect(keysOf(history)).toEqual(new Set(['k-marker', 'k-record']))
  })
})
