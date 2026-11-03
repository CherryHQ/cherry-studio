import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { claudeCodeAdapter } from '../claudeCode'
import { IMPORT_LIMITS } from '../types'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cherry-history-parser-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
function record(uuid: string, parentUuid: string | null, type = 'user', timestamp = '2026-01-01T00:00:00Z') {
  return {
    type,
    uuid,
    parentUuid,
    timestamp,
    sessionId: 'source-session',
    version: '2.1.284',
    message: {
      role: type,
      content: uuid,
      ...(type === 'assistant' ? { model: 'claude-model', stop_reason: 'end_turn' } : {})
    }
  }
}
async function read(records: unknown[], branch?: string) {
  const file = path.join(root, 'session.jsonl')
  await writeFile(file, records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'))
  return claudeCodeAdapter.read({ path: file }, new AbortController().signal, branch)
}

describe('Claude history projection', () => {
  it('keeps source boundaries and equal timestamps without losing a trailing user message', async () => {
    const result = await read([record('u', null), record('a', 'u', 'assistant'), record('tail', 'a')])
    expect(result.messages.map((m) => [m.role, m.data.parts?.[0]])).toEqual([
      ['user', { type: 'text', text: 'u' }],
      ['assistant', { type: 'text', text: 'a' }],
      ['user', { type: 'text', text: 'tail' }]
    ])
    expect(result.messages.map((m) => m.timestamp)).toEqual([1767225600000, 1767225600000, 1767225600000])
    expect(result.diagnostics).toEqual([])
  })
  it('does not combine alternative branches', async () => {
    const rows = [record('u', null), record('a', 'u', 'assistant'), record('b', 'u', 'assistant')]
    expect((await read(rows)).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'branch_required', severity: 'error' })
    )
    const selected = await read(rows, 'b')
    expect(selected.messages.map((m) => m.provenance.originalMessageId)).toEqual(['u', 'b'])
    expect(selected.skippedRecords).toBe(1)
  })
  it('reports broken JSON by line while preserving recoverable messages', async () => {
    const result = await read([record('u', null), '{broken', { type: 'future-record' }, record('a', 'u', 'assistant')])
    expect(result.messages).toHaveLength(2)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_json', line: 2 }),
        expect.objectContaining({ code: 'unsupported_record', line: 3 })
      ])
    )
  })
  it('rejects time regression instead of rewriting valid timestamps', async () => {
    const result = await read([record('u', null, 'user', '2026-01-02T00:00:00Z'), record('a', 'u', 'assistant')])
    expect(result.messages[1].timestamp).toBe(1767225600000)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'timestamp_order', severity: 'error' }))
  })
  it('infers a missing time only from a known earlier time', async () => {
    const result = await read([record('u', null), { ...record('a', 'u', 'assistant'), timestamp: 'invalid' }])
    expect(result.messages[1].provenance.inferredTimestamp).toBe(true)
    expect(result.messages[1].timestamp).toBe(1767225600000)
    expect((await read([{ ...record('u', null), timestamp: 'invalid' }])).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing_time', severity: 'error' })
    )
  })
  it('turns tool output into inert history instead of a user action', async () => {
    const call = {
      ...record('a', null, 'assistant'),
      message: { content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'echo safe' } }] }
    }
    const output = {
      ...record('r', 'a'),
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'safe' }] }
    }
    const result = await read([call, output])
    expect(result.messages[1].role).toBe('system')
    expect(result.messages.flatMap((m) => m.data.parts ?? []).every((p) => p.type === 'text')).toBe(true)
    expect(result.messages[1].data.parts).toEqual([
      { type: 'text', text: expect.stringContaining('Historical tool result: Bash') }
    ])
  })
  it('blocks broken ancestry and ambiguous source identity', async () => {
    const result = await read([record('u', 'missing'), { ...record('a', 'u', 'assistant'), sessionId: 'other' }])
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'broken_parent_chain', severity: 'error' }),
        expect.objectContaining({ code: 'unstable_identity', severity: 'error' })
      ])
    )
  })
  it('refuses oversized lines instead of importing a prefix', async () => {
    await expect(read([' '.repeat(IMPORT_LIMITS.line + 1)])).rejects.toThrow('line_limit')
  })
  it('matches the pinned Claude SDK reader for the supported transcript layout', async () => {
    const { getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk')
    const sessionId = 'f967ea72-ac9b-4912-939a-f59b2cce57f3'
    const userId = 'd602b279-93c1-4235-9e64-20359a67359b'
    const assistantId = '7bd1b1ba-5ae7-440e-ac99-a04b0d33f171'
    const rows = [
      { ...record(userId, null), sessionId, cwd: root },
      { ...record(assistantId, userId, 'assistant'), sessionId, cwd: root }
    ]
    const native = await getSessionMessages(sessionId, {
      dir: root,
      sessionStore: {
        async load(key) {
          return key.sessionId === sessionId ? rows : null
        },
        async append() {
          throw new Error('Reader must not write')
        }
      }
    })
    const normalized = await read(rows)
    expect(native.map((message) => message.uuid)).toEqual([userId, assistantId])
    expect(normalized.messages.map((message) => message.provenance.originalMessageId)).toEqual(
      native.map((message) => message.uuid)
    )
  })
  it('uses a source title, then the first real user request, including discovery', async () => {
    const records = [
      {
        ...record('c', null),
        message: {
          content:
            '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>'
        }
      },
      { ...record('u', 'c'), message: { content: 'Explain models.py briefly' } }
    ]
    expect((await read(records)).title).toBe('Explain models.py briefly')
    const refs: { title?: string }[] = []
    for await (const ref of claudeCodeAdapter.discover(root, new AbortController().signal)) refs.push(ref)
    expect(refs[0].title).toBe('Explain models.py briefly')
    expect((await read([...records, { type: 'custom-title', customTitle: 'My task' }])).title).toBe('My task')
  })
  it('classifies local commands as historical system text and skips CLI caveats', async () => {
    const result = await read([
      {
        ...record('c', null),
        isMeta: true,
        message: { content: '<local-command-caveat>transport notice</local-command-caveat>' }
      },
      {
        ...record('o', 'c'),
        message: { content: '<local-command-stdout>Set model to \u001b[1mmodel\u001b[22m</local-command-stdout>' }
      },
      { ...record('u', 'o'), message: { content: 'Actual request' } }
    ])
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(result.messages[0].data.parts).toEqual([
      { type: 'text', text: expect.stringContaining('Set model to model') }
    ])
    expect(result.title).toBe('Actual request')
  })
})
