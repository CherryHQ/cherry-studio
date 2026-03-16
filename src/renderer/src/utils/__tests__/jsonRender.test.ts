import { describe, expect, it } from 'vitest'

import { preprocessJsonRender } from '../jsonRender'

describe('preprocessJsonRender', () => {
  it('returns content unchanged when no json-render tags present', () => {
    const input = 'Hello world\n```json\n{"key": "value"}\n```'
    expect(preprocessJsonRender(input)).toBe(input)
  })

  it('converts complete <json-render> block to fenced code block', () => {
    const input = 'Some text\n<json-render>\n{"op":"add","path":"/root","value":"card-1"}\n</json-render>\nMore text'
    const result = preprocessJsonRender(input)
    expect(result).toContain('```json-render')
    expect(result).toContain('{"op":"add","path":"/root","value":"card-1"}')
    expect(result).toContain('```\nMore text')
    expect(result).not.toContain('<json-render>')
    expect(result).not.toContain('</json-render>')
  })

  it('converts unclosed <json-render> block (streaming) to open fence', () => {
    const input = 'Some text\n<json-render>\n{"op":"add","path":"/root","value":"card-1"}'
    const result = preprocessJsonRender(input)
    expect(result).toContain('```json-render')
    expect(result).toContain('{"op":"add","path":"/root","value":"card-1"}')
    // Should NOT have a closing fence
    const fenceCount = (result.match(/```/g) || []).length
    expect(fenceCount).toBe(1) // Only the opening fence
  })

  it('handles multiple complete blocks', () => {
    const input =
      '<json-render>\n{"op":"add","path":"/root","value":"a"}\n</json-render>\n\n<json-render>\n{"op":"add","path":"/root","value":"b"}\n</json-render>'
    const result = preprocessJsonRender(input)
    const fenceCount = (result.match(/```json-render/g) || []).length
    expect(fenceCount).toBe(2)
  })

  it('does not modify json-render text inside existing code blocks', () => {
    const input = '```html\n<json-render>test</json-render>\n```'
    const result = preprocessJsonRender(input)
    expect(result).toBe(input)
  })

  it('does not modify json-render text inside inline code', () => {
    const input = 'Use `<json-render>` tags in your response'
    const result = preprocessJsonRender(input)
    expect(result).toBe(input)
  })

  it('handles empty content inside tags', () => {
    const input = '<json-render></json-render>'
    const result = preprocessJsonRender(input)
    expect(result).toContain('```json-render')
  })

  it('handles direct JSON spec format', () => {
    const spec = '{"root":"card-1","elements":{"card-1":{"type":"Card","props":{"title":"Hello"},"children":[]}}}'
    const input = `<json-render>\n${spec}\n</json-render>`
    const result = preprocessJsonRender(input)
    expect(result).toContain('```json-render')
    expect(result).toContain(spec)
  })
})
