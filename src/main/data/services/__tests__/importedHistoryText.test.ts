import { describe, expect, it } from 'vitest'

import { formatClaudeHistoryText, formatClaudeTool, presentClaudeHistory } from '../importedHistoryText'

describe('Claude imported history presentation', () => {
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
