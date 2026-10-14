import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { AgentRuntimeModel, SubagentModelCandidate, SubagentPort } from '../src'
import {
  recordingSubagentPort,
  routedModel,
  storingSubagentPort,
  subagentCall,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, MODEL, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

const SONNET_OR: AgentRuntimeModel = { ...MODEL, provider: 'openrouter', key: 'or::sonnet', id: 'sonnet-4.5' }
const SONNET_AN: AgentRuntimeModel = { ...MODEL, provider: 'anthropic', key: 'an::sonnet', id: 'claude-sonnet-4-5' }
const DEFAULT_SUB: AgentRuntimeModel = { ...MODEL, provider: 'cherry', key: 'cherry::small', id: 'small-model' }
const MODELS = [SONNET_OR, SONNET_AN, DEFAULT_SUB]
const CATALOG = [
  { key: SONNET_OR.key, provider: 'OpenRouter', model: 'Claude Sonnet 4.5' },
  { key: SONNET_AN.key, provider: 'Anthropic', model: 'Claude Sonnet 4.5' },
  { key: 'or::gpt', provider: 'OpenRouter', model: 'GPT-5' }
]

/** Matches like the host does: exact on the model name or provider + model name, loosely on a shared word. */
async function findModels(query: string): Promise<SubagentModelCandidate[]> {
  const q = query.toLowerCase()
  const words = q.split(/\s+/)
  return CATALOG.flatMap((entry) => {
    const exact = [entry.model, `${entry.provider} ${entry.model}`].some((name) => name.toLowerCase() === q)
    const loose = words.some((word) => `${entry.provider} ${entry.model}`.toLowerCase().includes(word))
    return exact || loose ? [{ ...entry, exact }] : []
  })
}

/** A host that gives each subagent the model its key names, or `fallback` when none is named. */
function modelPort(fallback?: AgentRuntimeModel, store = recordingSubagentPort()) {
  const port: SubagentPort = {
    ...store.port,
    findModels,
    async configure(subagent) {
      const options = await store.port.configure(subagent)
      const named = MODELS.find((model) => model.key === subagent.modelKey)
      const model = subagent.modelKey === undefined ? fallback : named
      return { ...options, ...(model ? { model } : {}) }
    }
  }
  return { ...store, port }
}

/** A parent that delegates once with `input` and lets the subagent report. */
function delegating(input: Record<string, unknown>) {
  return routedModel(({ userText, humanText }) => {
    if (userText.includes('TASK-A')) return reply('REPORT-A')
    if (humanText === 'Delegate')
      return [
        toolCallPart('call_a', 'subagent', { description: 'Check A', prompt: 'TASK-A', ...input }),
        finish('tool-calls')
      ]
    return reply('OK.')
  })
}

const childRequests = (requests: { sessionId: string | undefined; model: { id: string } }[], parentId: string) =>
  requests.filter((request) => request.sessionId !== parentId)

describe('subagent models', () => {
  // Breaks when a model the user named is not the one the subagent runs on, or the origin entry
  // records another model (a continuation would switch models).
  it('runs the subagent on the one model the user named', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5' })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents[0].modelKey).toBe(SONNET_OR.key)
    expect(childRequests(requests, session.sessionId).map((request) => request.model.id)).toEqual(['sonnet-4.5'])
    const origin = host.events.get(host.subagents[0].sessionId)![0]
    expect(origin).toMatchObject({ type: 'transcript-append', entries: [{ data: { modelKey: SONNET_OR.key } }] })
  })

  // Breaks when the package picks a provider for the user among several matches.
  it('asks the model to let the user choose when several providers have the named model', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'Claude Sonnet 4.5' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents).toEqual([])
    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'Several models match "Claude Sonnet 4.5":\n- OpenRouter / Claude Sonnet 4.5\n- Anthropic / Claude Sonnet 4.5\nAsk the user which one to use, then call subagent again with the provider and model name.'
    )
  })

  // Breaks when an unmatched name silently falls back to the parent's model.
  it('fails with similar names when no model matches', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'Sonnet 9' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents).toEqual([])
    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'No enabled model with tool support matches "Sonnet 9". Similar: OpenRouter / Claude Sonnet 4.5, Anthropic / Claude Sonnet 4.5'
    )
  })

  // Breaks when a host that does not provide the named model gets the parent's model silently.
  it('fails the launch when the host does not provide the named model', async () => {
    const recording = recordingSubagentPort()
    const port: SubagentPort = { ...recording.port, findModels }
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'The subagent needs the model or::sonnet, which the app did not provide.'
    )
  })

  // Breaks when a fork may switch models, which loses the prompt cache it shares with the parent.
  it('refuses a model for a fork', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5', fork: true })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
    )
  })

  // Breaks when the host's default subagent model is ignored, or the origin entry does not record it.
  it("runs on the host's default subagent model when none is named, else on the parent's", async () => {
    const withDefault = modelPort(DEFAULT_SUB)
    const first = delegating({})
    const firstPort = streamTextPort(first.model)
    const one = await createTestSession({ port: firstPort.port, subagents: withDefault.port })
    await one.session.prompt('Delegate')
    expect(withDefault.subagents[0].modelKey).toBeUndefined()
    expect(childRequests(firstPort.requests, one.session.sessionId).map((request) => request.model.id)).toEqual([
      'small-model'
    ])
    expect(withDefault.events.get(withDefault.subagents[0].sessionId)![0]).toMatchObject({
      entries: [{ data: { modelKey: DEFAULT_SUB.key } }]
    })

    const withoutDefault = modelPort()
    const second = delegating({})
    const secondPort = streamTextPort(second.model)
    const two = await createTestSession({ port: secondPort.port, subagents: withoutDefault.port })
    await two.session.prompt('Delegate')
    expect(childRequests(secondPort.requests, two.session.sessionId).map((request) => request.model.id)).toEqual([
      MODEL.id
    ])
  })

  // Breaks when a continuation asks the host for its default model instead of the first run's.
  it('continues a subagent on the model its first run used', async () => {
    const host = modelPort(DEFAULT_SUB, storingSubagentPort())
    const { model, calls } = routedModel(({ userText, humanText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'AGAIN' ? 'REPORT-2' : 'REPORT-1')
      if (humanText === 'Delegate')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (humanText === 'Again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'AGAIN' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port, subagents: host.port })
    await session.prompt('Delegate')
    await session.prompt('Again')
    await waitFor(() => calls.some((call) => call.lastText.includes('REPORT-2')))

    expect(host.subagents[1].modelKey).toBe(DEFAULT_SUB.key)
    expect(new Set(childRequests(requests, session.sessionId).map((request) => request.model.id))).toEqual(
      new Set(['small-model'])
    )
  })

  // Breaks when the model gets a parameter the host cannot honor.
  it('offers no model parameter when the host cannot find models', async () => {
    const { model, calls } = delegating({})
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate')

    const tool = calls[0].options.tools?.find((candidate) => candidate.name === 'subagent')
    expect(Object.keys((tool as { inputSchema: { properties: object } }).inputSchema.properties)).toEqual([
      'description',
      'prompt',
      'fork',
      'background'
    ])
  })
})
