import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CONVERSATION_ISLAND_MAX_LINE_BYTES,
  CONVERSATION_ISLAND_PROTOCOL_VERSION,
  type ConversationIslandActivityItem,
  type ConversationIslandCommand,
  decodeConversationIslandHelperEvent,
  encodeConversationIslandCommand,
  JsonLineDecoder
} from '../conversationIslandProtocol'

const fixtureDirectory = new URL(
  '../../../../../packages/conversation-island-helper/Tests/ConversationIslandCoreTests/Fixtures/',
  import.meta.url
)

const primaryActivity: ConversationIslandActivityItem = {
  activityId: 'topic-1',
  identityAvatar: '🤖',
  identityName: 'Assistant',
  state: 'streaming',
  statusText: '正在生成',
  title: '性能分析'
}

const secondaryActivity: ConversationIslandActivityItem = {
  activityId: 'topic-2',
  identityAvatar: '🧠',
  identityName: 'Reviewer',
  state: 'awaiting-confirmation',
  statusText: '等待确认',
  title: '检查变更'
}

const presentCommand: Extract<ConversationIslandCommand, { type: 'present' }> = {
  version: 1,
  type: 'present',
  revision: 42,
  payload: {
    displayId: 1,
    expanded: false,
    reducedMotion: false,
    theme: {
      appearance: 'dark',
      primaryColor: '#00B96B',
      fontFamily: ''
    },
    primaryActivityId: primaryActivity.activityId,
    activityCountText: '2 个活动',
    activities: [primaryActivity, secondaryActivity]
  }
}

function readFixtureLines(name: string): string[] {
  const contents = readFileSync(new URL(name, fixtureDirectory), 'utf8')
  expect(contents.endsWith('\n')).toBe(true)
  return contents.trimEnd().split('\n')
}

function encodeUnchecked(command: unknown): () => Buffer {
  return () => encodeConversationIslandCommand(command as ConversationIslandCommand)
}

describe('conversation island protocol', () => {
  it('exports the fixed protocol version and maximum line size', () => {
    expect(CONVERSATION_ISLAND_PROTOCOL_VERSION).toBe(1)
    expect(CONVERSATION_ISLAND_MAX_LINE_BYTES).toBe(1024 * 1024)
  })

  it('encodes each parent command fixture as exactly one newline-terminated JSON line', () => {
    const lines = readFixtureLines('parent-commands.jsonl')
    const commands = lines.map((line) => JSON.parse(line) as ConversationIslandCommand)

    expect(commands.map((command) => command.type)).toEqual(['present', 'dismiss', 'shutdown'])
    expect(commands[0]).toEqual(presentCommand)

    for (const [index, command] of commands.entries()) {
      const encoded = encodeConversationIslandCommand(command)

      expect(encoded.equals(Buffer.from(`${lines[index]}\n`))).toBe(true)
      expect(encoded.at(-1)).toBe(0x0a)
      expect(encoded.subarray(0, -1).includes(0x0a)).toBe(false)
    }
  })

  it.each([
    ['unknown version', { ...presentCommand, version: 2 }],
    ['unknown type', { version: 1, type: 'replace', revision: 42, payload: presentCommand.payload }],
    ['negative revision', { version: 1, type: 'dismiss', revision: -1 }],
    ['unsafe revision', { version: 1, type: 'dismiss', revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['fractional display id', { ...presentCommand, payload: { ...presentCommand.payload, displayId: 1.5 } }],
    ['empty activities', { ...presentCommand, payload: { ...presentCommand.payload, activities: [] } }],
    [
      'duplicate activity ids',
      { ...presentCommand, payload: { ...presentCommand.payload, activities: [primaryActivity, primaryActivity] } }
    ],
    [
      'missing primary activity',
      { ...presentCommand, payload: { ...presentCommand.payload, primaryActivityId: 'missing' } }
    ],
    [
      'empty activity id',
      {
        ...presentCommand,
        payload: {
          ...presentCommand.payload,
          primaryActivityId: '',
          activities: [{ ...primaryActivity, activityId: '' }]
        }
      }
    ],
    [
      'unknown activity state',
      {
        ...presentCommand,
        payload: {
          ...presentCommand.payload,
          activities: [{ ...primaryActivity, state: 'paused' }]
        }
      }
    ],
    [
      'unknown theme appearance',
      {
        ...presentCommand,
        payload: { ...presentCommand.payload, theme: { ...presentCommand.payload.theme, appearance: 'system' } }
      }
    ],
    [
      'navigation target in a wire activity',
      {
        ...presentCommand,
        payload: {
          ...presentCommand.payload,
          activities: [
            {
              ...primaryActivity,
              target: { conversationType: 'assistant', conversationId: primaryActivity.activityId }
            }
          ]
        }
      }
    ]
  ])('rejects a parent command with %s', (_name, command) => {
    expect(encodeUnchecked(command)).toThrow('Invalid conversation island command')
  })

  it('decodes every shared helper event fixture', () => {
    const events = readFixtureLines('helper-events.jsonl').map(decodeConversationIslandHelperEvent)

    expect(events).toEqual([
      { version: 1, type: 'ready', pid: 4242 },
      { version: 1, type: 'setExpanded', revision: 42, expanded: true },
      { version: 1, type: 'openActivity', revision: 42, activityId: 'topic-1' },
      { version: 1, type: 'hidden', revision: 43 }
    ])
  })

  it.each([
    ['invalid JSON', '{"version":1,"type":"ready","pid":42,"payload":"private-content"'],
    ['unknown version', '{"version":2,"type":"ready","pid":42,"payload":"private-content"}'],
    ['unknown type', '{"version":1,"type":"private-content","pid":42}'],
    ['zero pid', '{"version":1,"type":"ready","pid":0}'],
    ['fractional pid', '{"version":1,"type":"ready","pid":4.2}'],
    ['unsafe pid', `{"version":1,"type":"ready","pid":${Number.MAX_SAFE_INTEGER + 1}}`],
    ['negative revision', '{"version":1,"type":"hidden","revision":-1}'],
    ['fractional revision', '{"version":1,"type":"hidden","revision":4.2}'],
    ['unsafe revision', `{"version":1,"type":"setExpanded","revision":${Number.MAX_SAFE_INTEGER + 1},"expanded":true}`],
    ['non-boolean expanded state', '{"version":1,"type":"setExpanded","revision":1,"expanded":"yes"}'],
    ['empty activity id', '{"version":1,"type":"openActivity","revision":1,"activityId":""}'],
    ['unexpected payload', '{"version":1,"type":"ready","pid":42,"payload":"private-content"}']
  ])('rejects %s without exposing the input', (_name, line) => {
    let error: unknown

    try {
      decodeConversationIslandHelperEvent(line)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Invalid conversation island helper event')
    expect((error as Error).message).not.toContain(line)
    expect((error as Error).message).not.toContain('private-content')
  })
})

describe('JsonLineDecoder', () => {
  it('buffers a partial line and emits multiple complete lines from the next chunk', () => {
    const decoder = new JsonLineDecoder()

    expect(decoder.push(Buffer.from('{"version":1,"type":"rea'))).toEqual([])
    expect(decoder.push(Buffer.from('dy","pid":42}\n{"version":1,"type":"hidden","revision":7}\n'))).toEqual([
      { kind: 'line', line: '{"version":1,"type":"ready","pid":42}' },
      { kind: 'line', line: '{"version":1,"type":"hidden","revision":7}' }
    ])
  })

  it('preserves an emoji split across chunks', () => {
    const decoder = new JsonLineDecoder()
    const line = '{"title":"🤖"}'
    const encoded = Buffer.from(`${line}\n`)
    const emojiOffset = encoded.indexOf(Buffer.from('🤖'))

    expect(decoder.push(encoded.subarray(0, emojiOffset + 2))).toEqual([])
    expect(decoder.push(encoded.subarray(emojiOffset + 2))).toEqual([{ kind: 'line', line }])
  })

  it('reports invalid UTF-8 and continues with the next valid line', () => {
    const decoder = new JsonLineDecoder()
    const chunk = Buffer.concat([Buffer.from([0xc3, 0x28, 0x0a]), Buffer.from('valid\n')])

    expect(decoder.push(chunk)).toEqual([
      { kind: 'error', reason: 'invalid-utf8' },
      { kind: 'line', line: 'valid' }
    ])
  })

  it('accepts a line exactly at the byte limit', () => {
    const decoder = new JsonLineDecoder()
    const frames = decoder.push(
      Buffer.concat([Buffer.alloc(CONVERSATION_ISLAND_MAX_LINE_BYTES, 0x61), Buffer.from('\n')])
    )

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ kind: 'line' })
    expect(frames[0].kind === 'line' ? Buffer.byteLength(frames[0].line) : 0).toBe(CONVERSATION_ISLAND_MAX_LINE_BYTES)
  })

  it('reports an oversized line once, discards through LF, and recovers', () => {
    const decoder = new JsonLineDecoder()

    expect(decoder.push(Buffer.alloc(CONVERSATION_ISLAND_MAX_LINE_BYTES + 1, 0x61))).toEqual([
      { kind: 'error', reason: 'line-too-long' }
    ])
    expect(decoder.push(Buffer.from('discarded'))).toEqual([])
    expect(decoder.push(Buffer.from('\nvalid\n'))).toEqual([{ kind: 'line', line: 'valid' }])
  })

  it('reports and clears an incomplete line at EOF', () => {
    const decoder = new JsonLineDecoder()

    expect(decoder.push(Buffer.from('partial'))).toEqual([])
    expect(decoder.end()).toEqual({ frames: [], hadIncompleteLine: true })
    expect(decoder.end()).toEqual({ frames: [], hadIncompleteLine: false })
  })

  it('reports an oversized discarded tail as incomplete at EOF and resets', () => {
    const decoder = new JsonLineDecoder()

    expect(decoder.push(Buffer.alloc(CONVERSATION_ISLAND_MAX_LINE_BYTES + 1, 0x61))).toEqual([
      { kind: 'error', reason: 'line-too-long' }
    ])
    expect(decoder.end()).toEqual({ frames: [], hadIncompleteLine: true })
    expect(decoder.push(Buffer.from('valid\n'))).toEqual([{ kind: 'line', line: 'valid' }])
  })
})
