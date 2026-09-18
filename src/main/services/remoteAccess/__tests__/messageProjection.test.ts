import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { contentPage, getPartContent, listPartDetails } from '../messageDetails'
import { projectParts } from '../messageProjection'
import { methodSchemas } from '../protocol'

describe('remote conversation content boundaries', () => {
  it('keeps the final answer after long reasoning and hundreds of verbose tools', () => {
    const tools: CherryMessagePart[] = Array.from({ length: 150 }, (_, index) => ({
      type: 'dynamic-tool',
      toolName: 'Read',
      toolCallId: String(index),
      state: 'output-available',
      input: { path: 'private-input' },
      output: 'private-output'.repeat(1000)
    }))
    const projected = projectParts([
      { type: 'reasoning', text: '思考'.repeat(65536) },
      ...tools,
      { type: 'text', text: '最终答案\n```ts\nconst result = 42\n```' }
    ])
    expect(projected.parts.at(-1)).toMatchObject({ text: '最终答案\n```ts\nconst result = 42\n```', truncated: false })
    expect(projected.parts).toHaveLength(2)
    expect(projected.truncated).toBe(true)
    expect(JSON.stringify(projected)).not.toContain('private-input')
    expect(JSON.stringify(projected)).not.toContain('private-output')
  })

  it('does not change the default projection when only tool output changes', () => {
    const tool: CherryMessagePart = {
      type: 'dynamic-tool',
      toolName: 'Bash',
      toolCallId: 'tool',
      state: 'output-available',
      input: {},
      output: 'first'
    }
    expect(projectParts([tool])).toEqual(projectParts([{ ...tool, output: 'second' }]))
  })

  it('retains the answer when a trailing declaration contains many artifacts', () => {
    const projected = projectParts([
      { type: 'text', text: 'The exported reports are ready.' },
      {
        type: 'dynamic-tool',
        toolName: 'report_artifacts',
        toolCallId: 'report',
        state: 'output-available',
        input: { artifacts: Array.from({ length: 150 }, (_, index) => ({ path: `/reports/${index}.pdf` })) },
        output: 'ok'
      }
    ])
    expect(projected.parts[0]).toMatchObject({
      type: 'text',
      text: 'The exported reports are ready.',
      truncated: false
    })
    expect(projected.truncated).toBe(true)
  })

  it('sends artifact names without file bodies, URLs, paths, or descriptions', () => {
    const parts: CherryMessagePart[] = [
      { type: 'file', filename: 'image.png', mediaType: 'image/png', url: 'data:image/png;base64,PRIVATE' },
      {
        type: 'dynamic-tool',
        toolName: 'mcp__cherry-tools__report_artifacts',
        toolCallId: 'report',
        state: 'output-available',
        input: { artifacts: [{ path: '/private/report.pdf', description: 'private-description' }] },
        output: 'private-body'
      }
    ]
    const projected = projectParts(parts)
    expect(projected.parts).toEqual([
      { type: 'artifact', partIndex: 0, name: 'image.png', mediaType: 'image/png' },
      { type: 'artifact', partIndex: 1, artifactIndex: 0, name: 'report.pdf' }
    ])
    expect(JSON.stringify(projected)).not.toMatch(/private|PRIVATE|data:image/)
    const detail = getPartContent(parts, {
      sessionId: 'session',
      messageId: 'message',
      partIndex: 1,
      field: 'artifacts',
      offset: 0,
      limitBytes: 16384
    })
    expect(JSON.parse(detail.text).artifacts[0]).toEqual({
      path: '/private/report.pdf',
      description: 'private-description'
    })
  })

  it('preserves dedicated code blocks and returns tool errors only when requested', () => {
    const parts: CherryMessagePart[] = [
      { type: 'data-code', data: { language: 'ts', content: 'const answer = 42' } },
      {
        type: 'dynamic-tool',
        toolName: 'Bash',
        toolCallId: 'tool',
        state: 'output-error',
        input: {},
        errorText: 'Command timed out'
      }
    ]
    expect(projectParts(parts).parts).toEqual([
      { type: 'code', partIndex: 0, language: 'ts', text: 'const answer = 42', totalBytes: 17, truncated: false }
    ])
    expect(listPartDetails(parts, { sessionId: 's', messageId: 'm', limit: 20 }).items[1]).toMatchObject({
      type: 'tool',
      fields: ['input', 'error']
    })
    expect(
      getPartContent(parts, {
        sessionId: 's',
        messageId: 'm',
        partIndex: 1,
        field: 'error',
        offset: 0,
        limitBytes: 16384
      }).text
    ).toBe('Command timed out')
  })

  it('reassembles UTF-8 pages losslessly without splitting Chinese characters or emoji', () => {
    const original = '\uFEFF中文🍒abc'.repeat(10)
    let received = ''
    let offset: number | null = 0
    let revision: string | undefined
    while (offset !== null) {
      const page = contentPage(original, { offset, limitBytes: 7, revision })
      expect(page.text).not.toContain('\uFFFD')
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(7)
      received += page.text
      offset = page.nextOffset
      revision = page.revision
    }
    expect(received).toBe(original)
  })

  it('rejects mixing revisions and offsets inside a UTF-8 character', () => {
    const first = contentPage('original text', { offset: 0, limitBytes: 4 })
    expect(() => contentPage('changed text', { offset: 4, limitBytes: 4, revision: first.revision })).toThrow(
      'CONTENT_CHANGED'
    )
    expect(() => contentPage('中文', { offset: 1, limitBytes: 4 })).toThrow('INVALID_REQUEST')
    expect(
      methodSchemas['messages.parts.get'].safeParse({
        sessionId: 's',
        messageId: 'm',
        partIndex: 0,
        field: 'text',
        offset: 4
      }).success
    ).toBe(false)
  })
})
