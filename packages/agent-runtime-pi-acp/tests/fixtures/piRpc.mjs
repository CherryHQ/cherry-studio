#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n')
const model = { id: 'fixture', provider: 'test', name: 'Fixture', contextWindow: 16000 }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.type === 'extension_ui_response') {
    writeFileSync('ui-response.json', JSON.stringify(request))
    emit({ type: 'agent_settled' })
    continue
  }
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
  if (request.type === 'get_session_stats' && process.env.PI_FIXTURE_STATS_LOG) {
    appendFileSync(process.env.PI_FIXTURE_STATS_LOG, 'read\n')
  }
  const data =
    request.type === 'get_state'
      ? { sessionId: 'pi-test', model, thinkingLevel: 'off' }
      : request.type === 'get_available_models'
        ? { models: [model] }
        : request.type === 'get_available_thinking_levels'
          ? { levels: ['off'] }
          : request.type === 'get_session_stats'
            ? { contextUsage: { tokens: 7000, contextWindow: model.contextWindow } }
            : {}
  emit({ type: 'response', id: request.id, command: request.type, success: true, data })
  if (request.type === 'abort') emit({ type: 'agent_settled' })
  if (request.type === 'prompt') {
    const outcome = request.message
    if (outcome === 'input' || outcome === 'editor') {
      emit({
        type: 'extension_ui_request',
        id: 'extension-dialog',
        method: outcome,
        title: 'Release notes',
        ...(outcome === 'input' ? { placeholder: 'Enter notes' } : { prefill: 'first\nsecond' })
      })
      continue
    }
    const end = (stopReason) =>
      emit({
        type: 'agent_end',
        messages: [
          {
            role: 'assistant',
            model: model.id,
            provider: model.provider,
            stopReason,
            ...(stopReason === 'stop'
              ? {
                  usage: { input: 3, output: 150, cacheRead: 0, cacheWrite: 5523, totalTokens: 5676, reasoning: 116 }
                }
              : request.type === 'get_session_stats'
                ? { contextUsage: { tokens: 7000, contextWindow: model.contextWindow } }
                : {}),
            errorMessage: 'Fixture provider rejected the model'
          }
        ]
      })
    if (outcome === 'retry-success') end('error')
    if (outcome === 'multiple') end('stop')
    end(outcome === 'error' || outcome === 'cancel' ? 'error' : outcome === 'length' ? 'length' : 'stop')
    if (outcome === 'compacted') emit({ type: 'compaction_end' })
    if (outcome !== 'cancel') emit({ type: 'agent_settled' })
  }
}
