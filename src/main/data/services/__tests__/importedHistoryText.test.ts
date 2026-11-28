import { describe, expect, it } from 'vitest'

import {
  formatClaudeHistoryText,
  formatClaudeTool,
  presentClaudeHistory,
  presentImportedTools
} from '../importedHistoryText'

describe('Claude imported history presentation', () => {
  it('projects each OpenCode tool outcome independently of its enclosing message', () => {
    const activity = (state: object) => ({
      type: 'text' as const,
      text: '[Historical tool activity]\n' + JSON.stringify({ type: 'tool', tool: 'read', state })
    })
    const input = { filePath: 'notes.md' }
    const time = { start: 10, end: 20 }
    const failed = activity({ status: 'error', input, time, error: 'File not found' })
    const completed = activity({ status: 'completed', input, time, output: 'Second read succeeded' })
    const presented = presentImportedTools(
      'opencode',
      'message',
      'assistant',
      { parts: [failed, completed] },
      'success'
    )
    expect(presented.data.parts).toMatchObject([
      { type: 'dynamic-tool', toolName: 'historical_tool', input, state: 'output-error', errorText: 'File not found' },
      { type: 'dynamic-tool', state: 'output-available', output: 'Second read succeeded' }
    ])
    expect(failed.type).toBe('text')
    expect(presented.data.parts?.[0]).not.toHaveProperty('approval')
  })
  it('preserves interrupted WorkBuddy tool state without creating an executable action', () => {
    const data = { parts: [{ type: 'text' as const, text: '[Historical tool result: read]\nInterrupted' }] }
    const presented = presentImportedTools('workbuddy', 'message', 'system', data, 'paused')
    expect(presented.role).toBe('assistant')
    expect(presented.data.parts?.[0]).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-error',
      errorText: 'Interrupted'
    })
    expect(presented.data.parts?.[0]).not.toHaveProperty('approval')
    expect(data.parts[0].text).toBe('[Historical tool result: read]\nInterrupted')
  })
  it('projects historical tools as completed read-only assistant items without changing their persisted text', () => {
    const data = { parts: [{ type: 'text' as const, text: '[Historical tool result: Read]\n\nfile content' }] }
    const result = presentImportedTools('claude-code', 'message', 'system', data)
    expect(result.role).toBe('assistant')
    expect(result.data.parts?.[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'historical_tool',
      state: 'output-available',
      output: 'file content'
    })
    expect(result.data.parts?.[0]).not.toHaveProperty('approval')
    expect(data.parts[0].text).toContain('[Historical tool result: Read]')
    expect(presentImportedTools('claude-code', 'message', 'user', data)).toEqual({ role: 'user', data })
    expect(
      presentImportedTools('claude-code', 'context', 'system', {
        parts: [{ type: 'text', text: '[Historical environment]\ncwd: /repo' }]
      }).role
    ).toBe('system')
  })
  it('renders CLI commands and terminal output without transport tags or ANSI escapes', () => {
    const command =
      '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>'
    expect(formatClaudeHistoryText(command)).toContain('[Historical local command]\n\n/model')
    const output = formatClaudeHistoryText(
      '<local-command-stdout>Set model to \u001b[1mmodel\u001b[22m</local-command-stdout>'
    )
    expect(output).toContain('Set model to model')
    expect(output).not.toContain('\u001b')
    expect(output).not.toContain('<local-command-stdout>')
  })
  it('repairs the prior persisted tool encoding without changing the stored message', () => {
    const data = {
      parts: [
        {
          type: 'text' as const,
          text:
            '[Historical tool result: Read]\n' +
            JSON.stringify({ type: 'tool_result', content: 'first\nsecond', tool_use_id: 'call' })
        }
      ]
    }
    const result = presentClaudeHistory(data)
    expect(result.parts?.[0]).toEqual({
      type: 'text',
      text: '[Historical tool result: Read]\n\nfirst\nsecond'
    })
    expect(data.parts[0].text).toContain('tool_use_id')
  })
  it('keeps plain tool result text intact and does not embed attachment bytes', () => {
    const text = formatClaudeTool(
      {
        type: 'tool_result',
        content: [
          { type: 'text', text: '```html\n<img src=x>\n```' },
          { type: 'image', source: { data: 'BASE64' } }
        ]
      },
      'Read'
    )
    expect(text).toContain('```html\n<img src=x>\n```')
    expect(text).toContain('[Historical attachment]')
    expect(text).not.toContain('BASE64')
    expect(formatClaudeHistoryText(text)).toBe(text)
  })
  it('preserves normal Markdown, XML code examples and malformed legacy text', () => {
    for (const text of [
      '# title\n\n**bold**',
      'Example: <command-name>/model</command-name>',
      '[Historical tool call]\n{broken'
    ])
      expect(formatClaudeHistoryText(text)).toBe(text)
  })
})
