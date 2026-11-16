import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it } from 'vitest'

import { createAutomationReplToolEntries } from '../AutomationReplTools'

const NOTE =
  'This automation tool result could not be read back from the conversation history. Ignore it and observe the current state again before acting.'

const entries = createAutomationReplToolEntries()
const repl = entries.find((entry) => entry.name === 'automation_repl')!
const variants = [
  ...entries.map((entry) => ({ label: entry.name, name: entry.name, tool: entry.tool })),
  {
    label: 'request-materialized automation_repl',
    name: repl.name,
    tool: repl.buildTool!({ browserEnabled: true, computerUseEnabled: false, mcpToolIds: new Set() })
  }
]

describe.each(variants)('$label output projection', ({ name, tool }) => {
  const format = (output: unknown) =>
    tool.toModelOutput!({ toolCallId: 'automation-call', input: { code: '1' }, output })

  beforeEach(() => mockMainLoggerService.warn.mockClear())

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['top-level marker', '<persisted-output>…</persisted-output>'],
    ['empty object', {}],
    ['array', []],
    ['boolean', false],
    ['number', 0],
    ['null content', { content: null }],
    ['string content', { content: 'bad' }],
    ['object content', { content: {} }],
    ['null block', { content: [null] }],
    ['array block', { content: [[]] }],
    ['missing type', { content: [{}] }],
    ['non-string type', { content: [{ type: 1 }] }],
    ['missing text', { content: [{ type: 'text' }] }],
    ['non-string text', { content: [{ type: 'text', text: 1 }] }],
    ['missing image MIME type', { content: [{ type: 'image', data: 'aGVsbG8=' }] }],
    ['non-string image data', { content: [{ type: 'image', data: null, mimeType: 'image/png' }] }],
    ['missing image data', { content: [{ type: 'image', mimeType: 'image/png' }] }],
    ['non-string image MIME type', { content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 1 }] }],
    ['valid text followed by malformed image', { content: [{ type: 'text', text: 'good' }, { type: 'image' }] }]
  ])('renders the note for %s', async (_label, output) => {
    expect(await format(output)).toEqual({ type: 'text', value: NOTE })
  })

  it('preserves text and image bytes in order', async () => {
    expect(
      await format({
        content: [
          { type: 'text', text: 'good' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
        ]
      })
    ).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'good' },
        { type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/png' }
      ]
    })
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['empty content', { content: [] }, []],
    ['empty text', { content: [{ type: 'text', text: '' }] }, [{ type: 'text', text: '' }]],
    [
      'empty image fields',
      { content: [{ type: 'image', data: '', mimeType: '' }] },
      [{ type: 'image-data', data: '', mediaType: '' }]
    ],
    ['unsupported string type', { content: [{ type: 'resource' }] }, []],
    [
      'ignored block beside text',
      { content: [{ type: 'resource' }, { type: 'text', text: 'kept' }] },
      [{ type: 'text', text: 'kept' }]
    ],
    [
      'extra fields',
      { extra: true, content: [{ type: 'text', text: 'kept', extra: null }] },
      [{ type: 'text', text: 'kept' }]
    ],
    [
      'marker inside text',
      { content: [{ type: 'text', text: '<persisted-output>…</persisted-output>' }] },
      [{ type: 'text', text: '<persisted-output>…</persisted-output>' }]
    ]
  ])('accepts %s', async (_label, output, value) => {
    expect(await format(output)).toEqual({ type: 'content', value })
  })

  it('logs one payload-free warning identifying the failed call', async () => {
    expect(await format({ content: [{ type: 'text', text: 'private payload' }, {}] })).toEqual({
      type: 'text',
      value: NOTE
    })
    expect(mockMainLoggerService.warn.mock.calls).toEqual([
      [
        'Unreadable automation tool output',
        { toolName: name, toolCallId: 'automation-call', reason: 'invalid-output-shape' }
      ]
    ])
  })
})
