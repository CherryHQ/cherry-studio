import { randomUUID } from 'node:crypto'

import type { SDKAssistantMessage, SDKPartialAssistantMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'

import { runtimeId, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { claudeThread } from '../src'
import { ClaudeProjection } from '../src/projection'
import { assistantMessage } from './wireFixture'

type NativeBlock = SDKAssistantMessage['message']['content'][number]

const providerErrors = [
  {
    type: 'web_search_tool_result',
    tool_use_id: 'call',
    content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }
  },
  {
    type: 'web_fetch_tool_result',
    tool_use_id: 'call',
    content: { type: 'web_fetch_tool_result_error', error_code: 'unavailable' }
  },
  {
    type: 'code_execution_tool_result',
    tool_use_id: 'call',
    content: { type: 'code_execution_tool_result_error', error_code: 'execution_time_exceeded' }
  },
  {
    type: 'bash_code_execution_tool_result',
    tool_use_id: 'call',
    content: { type: 'bash_code_execution_tool_result_error', error_code: 'execution_time_exceeded' }
  },
  {
    type: 'text_editor_code_execution_tool_result',
    tool_use_id: 'call',
    content: {
      type: 'text_editor_code_execution_tool_result_error',
      error_code: 'file_not_found',
      error_message: null
    }
  },
  {
    type: 'tool_search_tool_result',
    tool_use_id: 'call',
    content: {
      type: 'tool_search_tool_result_error',
      error_code: 'too_many_requests',
      error_message: 'Try again later'
    }
  }
] satisfies NativeBlock[]

it.each(providerErrors)('preserves $type failures in live and archived tool state', (block) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call = assistantMessage(sessionId, [{ type: 'server_tool_use', id: 'call', name: 'web_search', input: {} }])
  const result = assistantMessage(sessionId, [block])
  for (const message of [call, result]) projection.publish(projection.message(message))
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    type: 'dynamic-tool',
    state: 'output-error',
    errorText: expect.stringContaining(block.content.error_code),
    resultProviderMetadata: { anthropic: { result: block.content } }
  })
  const archived = new ClaudeProjection(projection.thread, (error) => {
    throw error
  })
  const archive = archived.restore(
    [call, result].map((message) => ({ ...message, parent_agent_id: null })),
    []
  )
  expect(archive.content[0].parts).toEqual(projection.feed.snapshot.messages[0].parts)
})

it('retains streaming metadata for a late observer before a complete message', async () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const partial = async (event: SDKPartialAssistantMessage['event']) => {
    projection.publish(
      await projection.partial({
        type: 'stream_event',
        event,
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null
      })
    )
  }
  const initialCitation = {
    type: 'char_location',
    cited_text: 'quote',
    document_index: 0,
    document_title: 'doc',
    start_char_index: 0,
    end_char_index: 5,
    file_id: null
  } as const
  const citation = { ...initialCitation, cited_text: 'second quote', start_char_index: 6, end_char_index: 18 }
  await partial({ type: 'message_start', message: assistantMessage(sessionId, []).message })
  await partial({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'redacted_thinking', data: 'ciphertext' }
  })
  await partial({ type: 'content_block_stop', index: 0 })
  await partial({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: '', signature: 'initial-signature' }
  })
  await partial({ type: 'content_block_stop', index: 1 })
  await partial({
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: 'Answer', citations: [initialCitation] }
  })
  await partial({ type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation } })
  await partial({ type: 'content_block_stop', index: 2 })
  await partial({
    type: 'content_block_start',
    index: 3,
    content_block: { type: 'thinking', thinking: 'Plan', signature: '' }
  })
  await partial({
    type: 'content_block_delta',
    index: 3,
    delta: { type: 'signature_delta', signature: 'streamed-signature' }
  })
  await partial({ type: 'content_block_stop', index: 3 })
  await partial({
    type: 'content_block_start',
    index: 4,
    content_block: { type: 'mcp_tool_use', id: 'lookup', name: 'lookup', input: {}, server_name: 'catalog' }
  })
  await partial({
    type: 'content_block_delta',
    index: 4,
    delta: { type: 'input_json_delta', partial_json: '{"query":"topic"}' }
  })
  await partial({ type: 'content_block_stop', index: 4 })
  const received: ObservationPayload[] = []
  const subscription = projection.feed.observe((batch) => {
    received.push(...batch.events)
  })
  await expect.poll(() => received.length).toBe(1)
  expect(received[0]).toMatchObject({
    messages: [
      {
        parts: [
          { type: 'reasoning', providerMetadata: { anthropic: { redactedData: 'ciphertext' } } },
          { type: 'reasoning', providerMetadata: { anthropic: { signature: 'initial-signature' } } },
          {
            type: 'text',
            text: 'Answer',
            providerMetadata: { anthropic: { citations: [initialCitation, citation] } }
          },
          { type: 'reasoning', text: 'Plan', providerMetadata: { anthropic: { signature: 'streamed-signature' } } },
          {
            type: 'dynamic-tool',
            toolCallId: 'lookup',
            state: 'input-available',
            input: { query: 'topic' },
            callProviderMetadata: { anthropic: { type: 'mcp_tool_use', serverName: 'catalog' } }
          }
        ]
      }
    ]
  })
  await subscription.stop()
  await projection.close()
})

it('does not interpret unknown archive blocks as tool results or discard their valid neighbors', () => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call: SessionMessage = {
    ...assistantMessage(sessionId, [{ type: 'tool_use', id: 'call', name: 'Read', input: {} }]),
    parent_agent_id: null
  }
  const mixed: SessionMessage = {
    ...call,
    uuid: randomUUID(),
    message: {
      content: [
        { type: 'future_block', tool_use_id: 'call', content: 'Not a tool result' },
        null,
        { type: 'text', text: 42 },
        { type: 'document', source: { type: 'file', file_id: 'native-file' } },
        { type: 'text', text: 'Still readable' }
      ]
    }
  }
  const archive = projection.restore([call, mixed], [])
  expect(archive.content[0].parts[0]).toMatchObject({ type: 'dynamic-tool', state: 'input-available' })
  expect(archive.content[0].parts[0]).not.toHaveProperty('output')
  expect(archive.content[1].parts).toEqual([{ type: 'text', text: 'Still readable', state: 'done' }])
  expect(archive.legacy?.[`${mixed.uuid}:4`]).toEqual({ messageId: mixed.uuid, parts: [0] })
  expect(archive.messages[1]).toEqual(mixed)
})

it.each([false, true])('keeps omitted tool output retracted after archive reconciliation (error: %s)', (isError) => {
  const sessionId = randomUUID()
  const projection = new ClaudeProjection(claudeThread(runtimeId('backend'), sessionId), (error) => {
    throw error
  })
  const call: SessionMessage = {
    type: 'assistant',
    uuid: 'call-message',
    session_id: sessionId,
    parent_tool_use_id: null,
    parent_agent_id: null,
    message: { content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { path: '/document' } }] }
  }
  const result: SessionMessage = {
    ...call,
    type: 'user',
    uuid: 'result-message',
    message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'Withdrawn output', is_error: isError }] }
  }
  const summary: SessionMessage = {
    ...call,
    uuid: 'summary',
    message: { content: [{ type: 'text', text: 'Selected summary' }] }
  }
  projection.restore([call, result], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    state: isError ? 'output-error' : 'output-available'
  })

  const archive = projection.restore([summary], [{ type: 'assistant', retracted_message_uuids: [result.uuid] }])
  expect(archive.retracted).toEqual([result.uuid])
  expect(archive.content.map((message) => message.id)).toEqual([summary.uuid])
  expect(projection.feed.snapshot.coverage).toBe('retained-view')
  expect(projection.feed.snapshot.messages.map((message) => message.id)).toEqual([call.uuid, summary.uuid])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
    type: 'dynamic-tool',
    toolCallId: 'call',
    input: { path: '/document' },
    state: 'input-available'
  })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')

  projection.restore([call, result, summary], [])
  expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({ state: 'input-available' })
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('output')
  expect(projection.feed.snapshot.messages[0].parts[0]).not.toHaveProperty('errorText')
})
