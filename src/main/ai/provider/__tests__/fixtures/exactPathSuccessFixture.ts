import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

/** Minimal local gateway wire responses, parsed by the real SDKs, not mock models. */
export function exactPathSuccessFixture(endpoint: EndpointType, streaming: boolean): string {
  const chat = {
    id: 'fixture',
    object: 'chat.completion',
    created: 1,
    model: 'fixture-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }
  const anthropic = {
    type: 'message',
    id: 'msg_fixture',
    model: 'fixture-model',
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  }
  const google = {
    candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
  }
  const responses = {
    id: 'resp_fixture',
    model: 'fixture-model',
    created_at: 1,
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'msg_fixture',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }]
      }
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
  }
  if (!streaming)
    return JSON.stringify(
      endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        ? anthropic
        : endpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
          ? google
          : endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
            ? responses
            : chat
    )
  const events =
    endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ? [
          {
            type: 'message_start',
            message: {
              id: 'msg_fixture',
              model: 'fixture-model',
              role: 'assistant',
              usage: { input_tokens: 1, output_tokens: 0 }
            }
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 1 }
          },
          { type: 'message_stop' }
        ]
      : endpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        ? [google]
        : endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
          ? [
              { type: 'response.created', response: { id: 'resp_fixture', created_at: 1, model: 'fixture-model' } },
              { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_fixture' } },
              { type: 'response.output_text.delta', item_id: 'msg_fixture', output_index: 0, delta: 'OK' },
              { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_fixture' } },
              { type: 'response.completed', response: responses }
            ]
          : [
              {
                id: 'fixture',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'fixture-model',
                choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }]
              },
              {
                id: 'fixture',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'fixture-model',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: chat.usage
              }
            ]
  return (
    events
      .map(
        (event) =>
          `${endpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? `event: ${'type' in event ? event.type : ''}\n` : ''}data: ${JSON.stringify(event)}\n\n`
      )
      .join('') +
    (endpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
      ? 'data: [DONE]\n\n'
      : '')
  )
}
