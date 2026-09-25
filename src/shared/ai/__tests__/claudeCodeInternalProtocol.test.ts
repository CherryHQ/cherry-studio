import { describe, expect, it } from 'vitest'

import {
  isClaudeCodeAgentLaunchReceipt,
  parseClaudeCodeBackgroundBashReceipt,
  splitClaudeCodeAgentCompletionReceipt
} from '../claudeCodeInternalProtocol'

describe('Claude Code internal protocol adapters', () => {
  it('parses the trailing background Bash receipt without swallowing path punctuation', () => {
    expect(
      parseClaudeCodeBackgroundBashReceipt(
        'Started\nCommand running in background with ID: task-1. Output is being written to: C:\\tmp.folder\\task-1.output'
      )
    ).toEqual({ taskId: 'task-1', outputFile: 'C:\\tmp.folder\\task-1.output' })
  })

  it('recognizes the supported local and remote Agent launch receipts', () => {
    expect(
      isClaudeCodeAgentLaunchReceipt('Async agent launched successfully. (This tool result is internal metadata)')
    ).toBe(true)
    expect(
      isClaudeCodeAgentLaunchReceipt('Remote agent launched successfully. (This tool result is internal metadata)')
    ).toBe(true)
    expect(isClaudeCodeAgentLaunchReceipt('Agent completed successfully')).toBe(false)
  })

  it('separates a completion receipt from user-visible Agent output', () => {
    expect(
      splitClaudeCodeAgentCompletionReceipt(
        'Review complete\n\n<usage>\nagentId: agent-1\nsubagent_tokens: 120 tool_uses: 3 duration_ms: 4500\n</usage>'
      )
    ).toEqual({
      text: 'Review complete',
      receipt: 'agentId: agent-1\nsubagent_tokens: 120 tool_uses: 3 duration_ms: 4500'
    })
  })
})
