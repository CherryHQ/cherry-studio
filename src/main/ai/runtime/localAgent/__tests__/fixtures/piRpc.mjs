#!/usr/bin/env node
import { createInterface } from 'node:readline'
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const model = { id: 'fixture', provider: 'test', name: 'Fixture', contextWindow: 1000 }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.type === 'prompt' && request.message === 'request-error') {
    emit({
      type: 'response',
      id: request.id,
      command: request.type,
      success: false,
      error: 'Fixture RPC rejected prompt'
    })
    continue
  }
  const data =
    request.type === 'get_state'
      ? { sessionId: 'pi-test', model, thinkingLevel: 'off' }
      : request.type === 'get_available_models'
        ? { models: [model] }
        : request.type === 'get_available_thinking_levels'
          ? { levels: ['off'] }
          : {}
  emit({ type: 'response', id: request.id, command: request.type, success: true, data })
  if (request.type === 'abort') emit({ type: 'agent_settled' })
  if (request.type === 'prompt') {
    const outcome = request.message
    const end = (stopReason) =>
      emit({
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason, errorMessage: 'Fixture provider rejected the model' }]
      })
    if (outcome === 'retry-success') end('error')
    end(outcome === 'error' || outcome === 'cancel' ? 'error' : outcome === 'length' ? 'length' : 'stop')
    if (outcome !== 'cancel') emit({ type: 'agent_settled' })
  }
}
