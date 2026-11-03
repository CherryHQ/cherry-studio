import { describe, expect, it } from 'vitest'

import { formatCodexHistoryText, formatCodexTool, presentCodexHistory } from '../importedCodexText'

describe('Codex imported text presentation', () => {
  it('shows command input instead of serialized tool metadata', () => {
    const result = formatCodexTool({
      type: 'function_call',
      name: 'exec_command',
      arguments: JSON.stringify({ cmd: 'first\nsecond', max_output_tokens: 500 }),
      call_id: 'opaque-id',
      internal_chat_message_metadata_passthrough: { turn_id: 'hidden' }
    })
    expect(result).toBe('[Historical tool call: exec_command]\n\nfirst\nsecond')
    expect(result).not.toContain('opaque-id')
  })
  it('unwraps nested command outputs into readable lines', () => {
    const result = formatCodexTool({
      type: 'custom_tool_call_output',
      output: [
        { type: 'input_text', text: 'Script completed' },
        {
          type: 'input_text',
          text:
            'Warning: truncated output (original token count: 50)\nTotal output lines: 1\n\n' +
            JSON.stringify({
              chunk_id: 'chunk',
              exit_code: 0,
              wall_time_seconds: 0.2,
              output: '# Handoff\r\n\r\nDetails'
            })
        }
      ]
    })
    expect(result).toContain('# Handoff\r\n\r\nDetails')
    expect(result).toContain('[Exit code: 0]')
    expect(result).toContain('Warning: truncated output')
    expect(result).not.toContain('chunk_id')
    expect(result).not.toContain('\\r\\n')
  })
  it('formats previously persisted Codex activity without mutating it', () => {
    const data = {
      parts: [
        {
          type: 'text' as const,
          text:
            '[Historical tool activity]\n' +
            JSON.stringify({ type: 'custom_tool_call_output', output: [{ type: 'input_text', text: 'old\nresult' }] })
        }
      ]
    }
    const formatted = presentCodexHistory(data)
    expect(formatted.parts?.[0]).toEqual({ type: 'text', text: '[Historical tool result]\n\nold\nresult' })
    expect(data.parts[0].text).toContain('custom_tool_call_output')
  })
  it('turns generated context and memory-reference markup into historical text', () => {
    expect(
      formatCodexHistoryText(
        '<environment_context><cwd>D:/project</cwd><shell>powershell</shell><filesystem>policy</filesystem></environment_context>'
      )
    ).toBe('[Historical environment]\n\ncwd: D:/project\nshell: powershell')
    expect(formatCodexHistoryText('<recommended_plugins>Plugin list</recommended_plugins>')).toBe(
      '[Historical plugin context]\n\nPlugin list'
    )
    const references = formatCodexHistoryText(
      'Answer\n<oai-mem-citation><citation_entries>notes.md:2-3|note=[context]</citation_entries><rollout_ids>opaque</rollout_ids></oai-mem-citation>'
    )
    expect(references).toContain('notes.md:2-3 — context')
    expect(references).not.toContain('<oai-mem-citation>')
    expect(references).not.toContain('opaque')
  })
  it('preserves ordinary JSON output and examples of markup', () => {
    const json = '{"output":"ordinary data","other":true}'
    expect(formatCodexTool({ type: 'function_call_output', output: json })).toContain(json)
    const text = 'Example: <environment_context>keep this</environment_context>'
    expect(formatCodexHistoryText(text)).toBe(text)
    expect(formatCodexHistoryText('[Historical tool activity]\n{broken')).toBe('[Historical tool activity]\n{broken')
  })
})
