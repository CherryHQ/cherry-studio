import { randomUUID } from 'node:crypto'

import type {
  SDKPartialAssistantMessage,
  SDKStatusMessage,
  SDKUserMessage,
  SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { claudeThread } from '../src/identity'
import { ClaudeProjection } from '../src/projection'
import type { ClaudeObservation } from '../src/types'
import { assistantMessage } from './wireFixture'

function fixture() {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  return {
    projection,
    sessionId,
    status(fields: Partial<SDKStatusMessage>) {
      projection.publish([], {
        source: 'live',
        message: {
          type: 'system',
          subtype: 'status',
          uuid: randomUUID(),
          session_id: sessionId,
          status: null,
          ...fields
        }
      })
    },
    text: () => JSON.stringify(projection.feed.snapshot.messages),
    message: (text: string) => assistantMessage(sessionId, [{ type: 'text', text, citations: null }])
  }
}

it('keeps compaction content native-only and resumes ordinary answers', async () => {
  const f = fixture()
  f.status({ status: 'compacting' })
  const internal = f.message('INTERNAL_TRANSFER')
  f.projection.publish(f.projection.message(internal, { live: true }), { source: 'live', message: internal })
  expect(f.text()).not.toContain('INTERNAL_TRANSFER')
  const batches: ClaudeObservation[] = []
  const observation = f.projection.feed.observe((batch) => {
    batches.push(batch)
  })
  await observation.drain()
  expect(JSON.stringify(batches[0].native)).toContain('INTERNAL_TRANSFER')
  await observation.stop()
  f.status({ status: null, compact_result: 'success' })
  const answer = f.message('Real answer with <analysis>literal instructions</analysis>')
  f.projection.publish(f.projection.message(answer, { live: true }), { source: 'live', message: answer })
  expect(f.text()).toContain('Real answer')
})

it.each([
  { status: null },
  { status: null, compact_result: 'failed' },
  { status: null, compact_error: 'failed' }
] satisfies Partial<SDKStatusMessage>[])('resumes after compaction exit %j', (exit) => {
  const f = fixture()
  f.status({ status: 'compacting' })
  f.status(exit)
  const answer = f.message('REAL_ANSWER')
  f.projection.publish(f.projection.message(answer, { live: true }), { source: 'live', message: answer })
  expect(f.text()).toContain('REAL_ANSWER')
})

it('does not revive suppressed content through delayed snapshots or native archive refresh', () => {
  const f = fixture()
  f.status({ status: 'compacting' })
  const internal = f.message('INTERNAL_TRANSFER')
  f.projection.publish(f.projection.message(internal, { live: true }), { source: 'live', message: internal })
  f.status({ status: null, compact_result: 'success' })
  f.projection.publish(f.projection.message(internal, { live: true }), { source: 'live', message: internal })
  expect(f.text()).not.toContain('INTERNAL_TRANSFER')
  const restored = f.projection.restore([{ ...internal, parent_agent_id: null }], [])
  expect(JSON.stringify(restored.content)).toContain('INTERNAL_TRANSFER')
  expect(f.text()).not.toContain('INTERNAL_TRANSFER')
})

it('does not project delayed completion of a suppressed stream after success', async () => {
  const f = fixture()
  f.status({ status: 'compacting' })
  const internal = f.message('INTERNAL_STREAM')
  const partial = async (event: SDKPartialAssistantMessage['event']) => {
    f.projection.publish(
      await f.projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: f.sessionId,
        parent_tool_use_id: null
      })
    )
  }
  await partial({ type: 'message_start', message: internal.message })
  await partial({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } })
  await partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'INTERNAL_STREAM' } })
  f.status({ status: null, compact_result: 'success' })
  f.projection.publish(f.projection.message(internal, { live: true }), { source: 'live', message: internal })
  expect(f.text()).not.toContain('INTERNAL_STREAM')
})

it('keeps a known submitted user prompt during compaction', () => {
  const f = fixture()
  f.status({ status: 'compacting' })
  const user: SDKUserMessage = {
    type: 'user',
    uuid: randomUUID(),
    session_id: f.sessionId,
    parent_tool_use_id: null,
    message: { role: 'user', content: 'GENUINE_PROMPT' }
  }
  f.projection.publish(f.projection.message(user, { inputId: runtimeId('input') }), { source: 'live', message: user })
  expect(f.text()).toContain('GENUINE_PROMPT')
})

it('keeps explicitly marked compact summaries native-only in fresh archives', () => {
  const f = fixture()
  const summary: SessionMessage = {
    type: 'user',
    uuid: randomUUID(),
    session_id: f.sessionId,
    parent_tool_use_id: null,
    parent_agent_id: null,
    message: { role: 'user', content: 'INTERNAL_ARCHIVE' }
  }
  const archive = f.projection.restore([summary], [{ type: 'user', uuid: summary.uuid, isCompactSummary: true }])
  expect(JSON.stringify(archive.content)).toContain('INTERNAL_ARCHIVE')
  expect(f.text()).not.toContain('INTERNAL_ARCHIVE')
})

it.each([
  '> - x\n`\n> <analysis>LITERAL</analysis>\n`\n',
  '[docs](https://example.com "Use `") `<analysis>LITERAL</analysis>`',
  '<analysis>These are user-facing example tags.</analysis>'
])('keeps ordinary answer text verbatim without wrapper guessing: %s', (text) => {
  const f = fixture()
  const answer = f.message(text)
  f.projection.publish(f.projection.message(answer, { live: true }), { source: 'live', message: answer })
  expect(f.projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ type: 'text', text })
})

it.each([
  '> - x\n`\n> <analysis>LITERAL</analysis>\n`\n',
  '[docs](https://example.com "Use `") `<analysis>LITERAL</analysis>`'
])('preserves ordinary XML through every stream split and completed snapshot: %s', async (text) => {
  for (let split = 0; split <= text.length; split++) {
    const f = fixture()
    const answer = f.message(text)
    const partial = async (event: SDKPartialAssistantMessage['event']) => {
      f.projection.publish(
        await f.projection.partial({
          type: 'stream_event',
          event,
          uuid: randomUUID(),
          session_id: f.sessionId,
          parent_tool_use_id: null
        })
      )
    }
    await partial({ type: 'message_start', message: answer.message })
    await partial({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } })
    for (const delta of [text.slice(0, split), text.slice(split)]) {
      if (delta) await partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } })
    }
    await partial({ type: 'content_block_stop', index: 0 })
    expect(f.projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ type: 'text', text })
    f.projection.publish(f.projection.message(answer, { live: true }), { source: 'live', message: answer })
    expect(f.projection.feed.snapshot.messages).toHaveLength(1)
    expect(f.projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ type: 'text', text })
    await f.projection.close()
  }
})

it('suppresses fragmented compaction content and still preserves child projection output', async () => {
  const root = fixture()
  const child = fixture()
  root.status({ status: 'compacting' })
  const internal = root.message('INTERNAL_STREAM')
  const partial = async (event: SDKPartialAssistantMessage['event']) => {
    root.projection.publish(
      await root.projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: root.sessionId,
        parent_tool_use_id: null
      })
    )
  }
  await partial({ type: 'message_start', message: internal.message })
  await partial({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } })
  for (const text of 'INTERNAL_STREAM')
    await partial({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  await partial({ type: 'content_block_stop', index: 0 })
  expect(root.text()).not.toContain('INTERNAL_STREAM')
  const output = child.message('CHILD_ANSWER')
  child.projection.publish(child.projection.message(output, { live: true }), { source: 'live', message: output })
  expect(child.text()).toContain('CHILD_ANSWER')
})
