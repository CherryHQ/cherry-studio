import { describe, expect, it } from 'vitest'

import { formatCodexHistoryText, formatCodexTool, isCodexContextText, presentCodexHistory } from '../importedCodexText'

describe('Codex imported text presentation', () => {
  it.each([
    '<environment_context><cwd>D:/project</cwd></environment_context>',
    '<recommended_plugins>Plugin list</recommended_plugins>',
    '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
    '# AGENTS.md instructions\n\n<INSTRUCTIONS>Project notes</INSTRUCTIONS>'
  ])('keeps user text outside a context block visible (%#)', (context) => {
    const question = 'Please fix the login failure.'
    expect(isCodexContextText(context)).toBe(true)
    for (const text of [
      context + '\n' + question,
      question + '\n' + context,
      context + '\n' + question + '\n' + context
    ]) {
      const data = { parts: [{ type: 'text' as const, text }] }
      expect(isCodexContextText(text)).toBe(false)
      expect(presentCodexHistory(data, 'user').parts).toEqual(data.parts)
    }
  })
  it('formats app context from a source envelope', () => {
    expect(
      formatCodexHistoryText('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>', 'user')
    ).toBe('[Historical app context]\n\n{"page_id":null}')
  })
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
    const formatted = presentCodexHistory(data, 'system')
    expect(formatted.parts?.[0]).toEqual({ type: 'text', text: '[Historical tool result]\n\nold\nresult' })
    expect(data.parts[0].text).toContain('custom_tool_call_output')
  })
  it('turns generated context and memory-reference markup into historical text', () => {
    expect(
      formatCodexHistoryText(
        '<environment_context><cwd>D:/project</cwd><shell>powershell</shell><filesystem>policy</filesystem></environment_context>',
        'system'
      )
    ).toBe('[Historical environment]\n\ncwd: D:/project\nshell: powershell')
    expect(formatCodexHistoryText('<recommended_plugins>Plugin list</recommended_plugins>', 'system')).toBe(
      '[Historical plugin context]\n\nPlugin list'
    )
    const references = formatCodexHistoryText(
      'Answer\n<oai-mem-citation><citation_entries>notes.md:2-3|note=[context]</citation_entries><rollout_ids>opaque</rollout_ids></oai-mem-citation>',
      'assistant'
    )
    expect(references).toBe('Answer\n**References**\n\n- notes.md:2-3 — context')
    expect(references).not.toContain('<oai-mem-citation>')
    expect(references).not.toContain('opaque')
  })
  it('presents stored references without changing literal user prompts or unrecognized entries', () => {
    const text = 'Answer\r\n\r\n[Historical references]\r\n\r\na.md:1-3 — context\r\nb.md:8 — next'
    const data = { parts: [{ type: 'text' as const, text }] }
    expect(presentCodexHistory(data, 'assistant').parts?.[0]).toEqual({
      type: 'text',
      text: 'Answer\r\n\r\n**References**\n\n- a.md:1-3 — context\n- b.md:8 — next'
    })
    expect(presentCodexHistory(data, 'user')).toEqual(data)
    const literal = '[Historical references]\n\nPlease explain this heading.'
    expect(formatCodexHistoryText(literal, 'assistant')).toBe(literal)
  })
  it('keeps malformed and quoted question replies intact', () => {
    for (const body of ['{broken', '[{"question":"Q"}]', '[]']) {
      const text = '<send_user_message_question_reply>' + body + '</send_user_message_question_reply>'
      expect(formatCodexHistoryText(text, 'user')).toBe(text)
    }
    const example =
      'Example: <send_user_message_question_reply>[{"question":"Q","answer":"A"}]</send_user_message_question_reply>'
    expect(formatCodexHistoryText(example, 'user')).toBe(example)
  })
  it('preserves ordinary JSON output and examples of markup', () => {
    const json = '{"output":"ordinary data","other":true}'
    expect(formatCodexTool({ type: 'function_call_output', output: json })).toContain(json)
    const text = 'Example: <environment_context>keep this</environment_context>'
    expect(formatCodexHistoryText(text, 'user')).toBe(text)
    expect(formatCodexHistoryText('[Historical tool activity]\n{broken', 'system')).toBe(
      '[Historical tool activity]\n{broken'
    )
  })
})
