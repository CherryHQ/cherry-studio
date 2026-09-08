import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import {
  findOpenTextTailIndex,
  type PartEntry,
  projectCompletedMessageParts,
  projectLiveMessageParts
} from '../messagePartLayouts'

function entries(parts: readonly Record<string, unknown>[]): PartEntry[] {
  return parts.map((part, index) => ({ part: part as CherryMessagePart, index }))
}

function indexes(items: readonly PartEntry[]): number[] {
  return items.map((entry) => entry.index)
}

const GENERATED_IMAGE_RESULTS: ReadonlyArray<[string, string, unknown]> = [
  ['Home image output', 'generate_image', [{ id: 'file-1', name: 'sunset.png' }]],
  [
    'inline Agent image output',
    'mcp__cherry-tools__generate_image',
    {
      content: [{ type: 'image', data: 'BASE64', mimeType: 'image/png' }],
      metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
    }
  ],
  [
    'deferred Agent image output',
    'mcp__cherry-tools__generate_image',
    {
      $deferredToolResult: {
        topicId: 'agent-session:session-1',
        messageId: 'message-1',
        toolCallId: 'generate-image'
      }
    }
  ]
]

function generateImagePart(toolName: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'dynamic-tool',
    toolCallId: 'generate-image',
    toolName,
    state: 'output-available',
    ...overrides
  }
}

describe('projectLiveMessageParts', () => {
  it('forms one process history through intermediate text and keys it by the first visible entry', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'step-start' },
        { type: 'reasoning', text: 'Inspecting', state: 'streaming' },
        { type: 'source-url', url: 'https://example.com' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' },
        { type: 'text', text: 'Interim note' },
        { type: 'data-citation', data: {} },
        { type: 'reasoning', text: 'Continuing', state: 'done' }
      ])
    )

    expect(layout).toHaveLength(1)
    expect(layout[0]).toMatchObject({ kind: 'process', key: 1 })
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([1, 3, 4, 6])
  })

  it('treats AskUserQuestion as a hard boundary between ordinary tool runs', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'approval-requested'
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 1],
      ['process', 2]
    ])
  })

  it('keeps approval-backed AskUserQuestion direct', () => {
    const layout = projectLiveMessageParts(
      entries([
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'approval-requested'
        }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([['part', 0]])
  })

  it('keeps approval-gated tools in one stable process as their state advances', () => {
    const requestedLayout = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing changes', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'approved',
          toolName: 'Write',
          state: 'approval-requested',
          approval: { id: 'approval-1' }
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )
    const respondedLayout = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing changes', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'approved',
          toolName: 'Write',
          state: 'approval-responded',
          approval: { id: 'approval-1', approved: true }
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(requestedLayout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(requestedLayout[0].kind === 'process' ? indexes(requestedLayout[0].entries) : []).toEqual([0, 1, 2, 3])
    expect(respondedLayout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(respondedLayout[0].kind === 'process' ? indexes(respondedLayout[0].entries) : []).toEqual([0, 1, 2, 3])
  })

  it('does not create visible runs from hidden markers or empty settled reasoning', () => {
    const hiddenOnly = projectLiveMessageParts(
      entries([
        { type: 'step-start' },
        { type: 'source-url' },
        { type: 'source-document' },
        { type: 'data-agent-task-event', data: {} },
        { type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } },
        { type: 'data-clear', data: {} }
      ])
    )
    const emptyReasoning = projectLiveMessageParts(entries([{ type: 'reasoning', text: '', state: 'done' }]))

    expect(hiddenOnly).toEqual([])
    expect(emptyReasoning).toEqual([])
  })

  it('does not let empty settled text or reasoning split a continuous tool run', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '' },
        { type: 'reasoning', text: '   ', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(layout).toHaveLength(1)
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 3])
  })

  it('treats provider ellipsis fillers as transparent within a live process run', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' },
        { type: 'source-url', url: 'https://example.com' },
        { type: 'text', text: '…' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' }
      ])
    )

    expect(layout).toHaveLength(1)
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 4])
  })

  it('holds only a process-adjacent trailing ellipsis while the next live part is unknown', () => {
    const processTail = projectLiveMessageParts(
      entries([
        { type: 'reasoning', text: 'Preparing tool call', state: 'done' },
        { type: 'text', text: '...' }
      ])
    )
    const standaloneEllipsis = projectLiveMessageParts(entries([{ type: 'text', text: '...' }]))

    expect(processTail).toHaveLength(1)
    expect(processTail[0].kind === 'process' ? indexes(processTail[0].entries) : []).toEqual([0])
    expect(standaloneEllipsis.map((item) => [item.kind, item.key])).toEqual([['part', 0]])
  })

  it('preserves ordinary prose containing an ellipsis', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'text', text: 'Wait...' },
        { type: 'text', text: '.....' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1, 2])
  })

  it('keeps intermediate text inside process history and only the trailing result outside', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'text', text: 'Before' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'input-available' },
        { type: 'text', text: 'After' }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 3]
    ])
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1, 2])
  })

  it('keeps a channel authentication QR result outside the live process', () => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'channel-auth',
          toolName: 'mcp__cherry-tools__config',
          state: 'output-available',
          input: { action: 'add_channel', type: 'wechat', auth_mode: 'qr' },
          output: {
            content: [
              { type: 'text', text: 'Scan this QR code' },
              { type: 'image', data: 'BASE64', mimeType: 'image/png' }
            ],
            metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
          }
        }
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 1]
    ])
  })

  it.each(GENERATED_IMAGE_RESULTS)('keeps %s outside the live process', (_label, toolName, output) => {
    const layout = projectLiveMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        generateImagePart(toolName, { output })
      ])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([
      ['process', 0],
      ['part', 1]
    ])
  })

  it.each(['generate_image', 'mcp__cherry-tools__generate_image'])(
    'keeps approval-requested %s calls inside the live process',
    (toolName) => {
      const layout = projectLiveMessageParts(
        entries([
          { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
          generateImagePart(toolName, {
            state: 'approval-requested',
            input: { prompt: 'A cherry tree at sunset' },
            approval: { id: 'approval-generate-image' }
          })
        ])
      )

      expect(layout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
      expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1])
    }
  )

  it.each([
    ['a Home error object', generateImagePart('generate_image', { output: { error: 'Image generation failed' } })],
    ['an empty Home result', generateImagePart('generate_image', { output: [] })],
    [
      'a thrown Home error',
      generateImagePart('generate_image', {
        state: 'output-error',
        errorText: 'Image generation failed'
      })
    ],
    [
      'a text-only Agent result',
      generateImagePart('mcp__cherry-tools__generate_image', {
        output: {
          content: [{ type: 'text', text: 'Image generation returned no images.' }],
          metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
        }
      })
    ],
    [
      'an errored Agent result',
      generateImagePart('mcp__cherry-tools__generate_image', {
        output: {
          isError: true,
          content: [{ type: 'text', text: 'Image generation failed' }],
          metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
        }
      })
    ]
  ])('keeps %s inside the live process', (_label, imagePart) => {
    const layout = projectLiveMessageParts(
      entries([{ type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' }, imagePart])
    )

    expect(layout.map((item) => [item.kind, item.key])).toEqual([['process', 0]])
    expect(layout[0].kind === 'process' ? indexes(layout[0].entries) : []).toEqual([0, 1])
  })
})

describe('findOpenTextTailIndex', () => {
  it('selects only the final text/code tail while ignoring trailing hidden markers', () => {
    expect(
      findOpenTextTailIndex(
        entries([
          { type: 'text', text: 'Earlier' },
          { type: 'data-code', data: { content: 'const value = 1', language: 'ts' } },
          { type: 'step-start' },
          { type: 'source-url' }
        ])
      )
    ).toBe(1)
  })

  it('returns null when a visible process/value part seals the text tail', () => {
    expect(
      findOpenTextTailIndex(
        entries([
          { type: 'text', text: 'Done' },
          { type: 'data-citation', data: {} },
          { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'input-available' }
        ])
      )
    ).toBeNull()
  })

  it('does not reopen a completed text tail when the turn becomes active again', () => {
    expect(findOpenTextTailIndex(entries([{ type: 'text', text: 'Already complete', state: 'done' }]))).toBeNull()
    expect(findOpenTextTailIndex(entries([{ type: 'text', text: 'Current delta', state: 'streaming' }]))).toBe(0)
  })
})

describe('projectCompletedMessageParts', () => {
  it('keeps the last substantive answer and associated values outside history despite trailing tools', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'Initial narration' },
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'data-video', data: { filePath: '/tmp/result.mp4' } },
        { type: 'reasoning', text: 'Bookkeeping', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'cleanup', toolName: 'Cleanup', state: 'output-available' }
      ])
    )

    expect(indexes(layout.resultEntries)).toEqual([2, 3, 4])
    expect(indexes(layout.historyEntries)).toEqual([0, 1, 5, 6])
  })

  it('keeps interleaved answer values in the same terminal result run', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'First answer paragraph' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'text', text: 'Second answer paragraph' },
        { type: 'dynamic-tool', toolCallId: 'cleanup', toolName: 'Cleanup', state: 'output-available' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 4])
    expect(indexes(layout.resultEntries)).toEqual([1, 2, 3])
  })

  it('does not let hidden transport markers split associated final-answer values', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'data-citation', data: {} },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'dynamic-tool', toolCallId: 'cleanup', toolName: 'Cleanup', state: 'output-available' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 4])
    expect(indexes(layout.resultEntries)).toEqual([1, 2, 3])
  })

  it('leaves pure text entirely in the result', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'text', text: 'First paragraph' },
        { type: 'data-code', data: { content: 'answer()', language: 'ts' } },
        { type: 'data-translation', data: { content: 'Translated answer' } }
      ])
    )

    expect(indexes(layout.resultEntries)).toEqual([0, 1, 2])
    expect(layout.historyEntries).toEqual([])
  })

  it('does not let an empty settled tail replace the last substantive answer', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'text', text: '' }
      ])
    )

    expect(indexes(layout.resultEntries)).toEqual([1])
    expect(indexes(layout.historyEntries)).toEqual([0])
  })

  it('lets an associated result value cross an empty terminal content part', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        { type: 'text', text: '' },
        { type: 'file', mediaType: 'application/pdf', url: 'file:///result.pdf' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1, 3])
  })

  it('removes only tool-bound ellipsis fillers from completed projection', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer...' }
      ])
    )
    const ellipsisAnswer = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: '...' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 2])
    expect(indexes(layout.resultEntries)).toEqual([3])
    expect(indexes(ellipsisAnswer.historyEntries)).toEqual([0])
    expect(indexes(ellipsisAnswer.resultEntries)).toEqual([1])
  })

  it.each([
    [
      'tools',
      [
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' }
      ]
    ],
    [
      'reasoning',
      [
        { type: 'reasoning', text: 'Thought one', state: 'done' },
        { type: 'reasoning', text: 'Thought two', state: 'done' }
      ]
    ]
  ])('keeps pure %s messages entirely in history', (_label, parts) => {
    const layout = projectCompletedMessageParts(entries(parts as Record<string, unknown>[]))

    expect(indexes(layout.historyEntries)).toEqual([0, 1])
    expect(layout.resultEntries).toEqual([])
  })

  it('keeps a value-only response and a final value tail outside process history', () => {
    const pureValues = projectCompletedMessageParts(
      entries([
        { type: 'data-error', data: { message: 'Failed' } },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'data-video', data: { filePath: '/tmp/result.mp4' } }
      ])
    )
    const trailingValues = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'source-url', url: 'https://example.com' },
        { type: 'file', mediaType: 'application/pdf', url: 'file:///result.pdf' }
      ])
    )

    expect(indexes(pureValues.resultEntries)).toEqual([0, 1, 2])
    expect(pureValues.historyEntries).toEqual([])
    expect(indexes(trailingValues.historyEntries)).toEqual([0])
    expect(indexes(trailingValues.resultEntries)).toEqual([1, 2])
  })

  it('does not extract an earlier value run when a process part is the terminal boundary', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'data-error', data: { message: 'Failed' } },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 1, 2])
    expect(layout.resultEntries).toEqual([])
  })

  it('keeps standalone tools in their original completed-history position', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'data-error', data: { message: 'Failed' } },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 1, 2, 3])
    expect(layout.resultEntries).toEqual([])
  })

  it('keeps a channel authentication QR tool outside completed history', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'channel-auth',
          toolName: 'mcp__cherry-tools__config',
          state: 'output-available',
          input: { action: 'add_channel', type: 'wechat', auth_mode: 'qr' },
          output: {
            content: [
              { type: 'text', text: 'Scan this QR code' },
              { type: 'image', data: 'BASE64', mimeType: 'image/png' }
            ],
            metadata: { type: 'mcp', serverId: 'cherry-tools', serverName: 'cherry-tools' }
          }
        }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1])
  })

  it('keeps a deferred channel authentication QR tool outside completed history', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'channel-auth',
          toolName: 'mcp__cherry-tools__config',
          state: 'output-available',
          input: { action: 'add_channel', type: 'feishu', auth_mode: 'qr' },
          output: {
            $deferredToolResult: {
              topicId: 'agent-session:session-1',
              messageId: 'message-1',
              toolCallId: 'channel-auth'
            }
          }
        }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1])
  })

  it('keeps a created Agent action outside completed history', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'create-agent',
          toolName: 'mcp__assistant__create_agent',
          state: 'output-available',
          output: {
            content: [
              {
                type: 'text',
                text: '{"ok":true,"agentId":"agent-created","name":"Reviewer","model":"anthropic::claude-sonnet"}'
              }
            ]
          }
        },
        { type: 'text', text: 'Created successfully.' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1, 2])
  })

  it('keeps only actionable diagnostic report results outside completed history', () => {
    const successful = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'prepare-report',
          toolName: 'mcp__assistant__prepare_diagnostic_report',
          state: 'output-available',
          output: {
            content: [{ type: 'text', text: 'Diagnostic report draft prepared.' }],
            structuredContent: { ok: true, description: 'Editable diagnostic report draft' },
            metadata: { type: 'mcp', serverId: 'assistant', serverName: 'assistant' }
          }
        }
      ])
    )
    const deferred = projectCompletedMessageParts(
      entries([
        {
          type: 'dynamic-tool',
          toolCallId: 'prepare-report',
          toolName: 'mcp__assistant__prepare_diagnostic_report',
          state: 'output-available',
          output: {
            $deferredToolResult: {
              topicId: 'agent-session:session-1',
              messageId: 'message-1',
              toolCallId: 'prepare-report'
            }
          }
        }
      ])
    )
    const failed = projectCompletedMessageParts(
      entries([
        {
          type: 'dynamic-tool',
          toolCallId: 'prepare-report',
          toolName: 'mcp__assistant__prepare_diagnostic_report',
          state: 'output-available',
          output: {
            content: [{ type: 'text', text: '{"ok":false,"description":"Unavailable draft"}' }],
            metadata: { type: 'mcp', serverId: 'assistant', serverName: 'assistant' }
          }
        }
      ])
    )

    expect(indexes(successful.historyEntries)).toEqual([0])
    expect(indexes(successful.resultEntries)).toEqual([1])
    expect(indexes(deferred.historyEntries)).toEqual([])
    expect(indexes(deferred.resultEntries)).toEqual([0])
    expect(indexes(failed.historyEntries)).toEqual([0])
    expect(indexes(failed.resultEntries)).toEqual([])
  })

  it.each(GENERATED_IMAGE_RESULTS)('keeps %s outside completed history', (_label, toolName, output) => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        generateImagePart(toolName, { output })
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1])
  })

  it('preserves an interleaved AskUser boundary inside completed history', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        },
        { type: 'dynamic-tool', toolCallId: 'edit', toolName: 'Edit', state: 'output-available' },
        { type: 'text', text: 'Final answer' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 1, 2])
    expect(indexes(layout.resultEntries)).toEqual([3])
  })

  it('does not let AskUserQuestion split adjacent main text', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'PR review result' },
        {
          type: 'dynamic-tool',
          toolCallId: 'ask',
          toolName: 'AskUserQuestion',
          state: 'output-available'
        },
        { type: 'reasoning', text: 'Waiting for input', state: 'done' },
        { type: 'text', text: 'Waiting for your choice' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0, 2, 3])
    expect(indexes(layout.resultEntries)).toEqual([1, 4])
  })

  it('extracts report_artifacts without letting it split the final answer result', () => {
    const layout = projectCompletedMessageParts(
      entries([
        { type: 'dynamic-tool', toolCallId: 'read', toolName: 'Read', state: 'output-available' },
        { type: 'text', text: 'Final answer' },
        {
          type: 'dynamic-tool',
          toolCallId: 'report',
          toolName: 'mcp__cherry__report_artifacts',
          state: 'output-available'
        },
        { type: 'file', mediaType: 'text/markdown', url: 'file:///report.md' }
      ])
    )

    expect(indexes(layout.historyEntries)).toEqual([0])
    expect(indexes(layout.resultEntries)).toEqual([1, 3])
    expect(indexes(layout.reportEntries)).toEqual([2])
  })
})
