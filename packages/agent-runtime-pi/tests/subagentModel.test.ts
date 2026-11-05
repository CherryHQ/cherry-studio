import { describe, expect, it } from 'vitest'

import type { AgentRuntimeModel, SubagentModelCandidate, SubagentPort } from '../src'
import { assistantReply, createTestSession, MODEL } from './sessionSupport'
import {
  recordingSubagentPort,
  reply,
  routedModel,
  storingSubagentPort,
  subagentCall,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { textOf } from './toolResults'

const SONNET_OR: AgentRuntimeModel = { ...MODEL, provider: 'openrouter', id: 'sonnet-4.5' }
const SONNET_AN: AgentRuntimeModel = { ...MODEL, provider: 'anthropic', id: 'claude-sonnet-4-5' }
const DEFAULT_SUB: AgentRuntimeModel = { ...MODEL, provider: 'cherry', id: 'small-model' }
const MODELS = [SONNET_OR, SONNET_AN, DEFAULT_SUB]
const CATALOG = [
  { key: `${SONNET_OR.provider}/${SONNET_OR.id}`, provider: 'OpenRouter', model: 'Claude Sonnet 4.5' },
  { key: `${SONNET_AN.provider}/${SONNET_AN.id}`, provider: 'Anthropic', model: 'Claude Sonnet 4.5' },
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
      const named = MODELS.find((model) => `${model.provider}/${model.id}` === subagent.modelKey)
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
      return assistantReply(
        [toolCallPart('call_a', 'subagent', { description: 'Check A', prompt: 'TASK-A', ...input })],
        'toolUse'
      )
    return reply('OK.')
  })
}

const childRequests = (requests: { sessionId?: string; model: { id: string } }[], parentId: string) =>
  requests.filter((request) => request.sessionId !== parentId)

describe('subagent models', () => {
  // Breaks when a model the user named is not the one the subagent runs on, or the origin entry
  // records another model (a continuation would switch models).
  it('runs the subagent on the one model the user named', async () => {
    const host = modelPort()
    const { model, requests } = delegating({ model: 'OpenRouter Claude Sonnet 4.5' })
    const { session } = await createTestSession({ stream: model, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents[0].modelKey).toBe(`${SONNET_OR.provider}/${SONNET_OR.id}`)
    expect(childRequests(requests, session.sessionId).map((request) => request.model.id)).toEqual(['sonnet-4.5'])
    const origin = host.sessions
      .get(host.subagents[0].sessionId)!
      .sessionManager.getBranch()
      .find((entry) => entry.type === 'custom' && entry.customType === 'cherry.subagent-origin')
    expect(origin).toMatchObject({ data: { modelKey: `${SONNET_OR.provider}/${SONNET_OR.id}` } })
  })

  // Breaks when the package picks a provider for the user among several matches.
  it('asks the model to let the user choose when several providers have the named model', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'Claude Sonnet 4.5' })
    const { session } = await createTestSession({ stream: model, subagents: host.port })
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
    const { session } = await createTestSession({ stream: model, subagents: host.port })
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
    const { session } = await createTestSession({ stream: model, subagents: port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'The subagent needs the model openrouter/sonnet-4.5, which the app did not provide.'
    )
  })

  // Breaks when a fork may switch models, which loses the prompt cache it shares with the parent.
  it('refuses a model for a fork', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5', fork: true })
    const { session } = await createTestSession({ stream: model, subagents: host.port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
    )
  })

  // Breaks when the host's default subagent model is ignored, or the origin entry does not record it.
  it("runs on the host's default subagent model when none is named, else on the parent's", async () => {
    const withDefault = modelPort(DEFAULT_SUB)
    const first = delegating({})
    const one = await createTestSession({ stream: first.model, subagents: withDefault.port })
    await one.session.prompt('Delegate')
    expect(withDefault.subagents[0].modelKey).toBeUndefined()
    expect(childRequests(first.requests, one.session.sessionId).map((request) => request.model.id)).toEqual([
      'small-model'
    ])
    expect(withDefault.sessions.get(withDefault.subagents[0].sessionId)!.sessionManager.getBranch()).toContainEqual(
      expect.objectContaining({
        type: 'custom',
        customType: 'cherry.subagent-origin',
        data: expect.objectContaining({ modelKey: `${DEFAULT_SUB.provider}/${DEFAULT_SUB.id}` })
      })
    )

    const withoutDefault = modelPort()
    const second = delegating({})
    const two = await createTestSession({ stream: second.model, subagents: withoutDefault.port })
    await two.session.prompt('Delegate')
    expect(childRequests(second.requests, two.session.sessionId).map((request) => request.model.id)).toEqual([MODEL.id])
  })

  // Breaks when a continuation asks the host for its default model instead of the first run's.
  it('continues a subagent on the model its first run used', async () => {
    const host = modelPort(DEFAULT_SUB, storingSubagentPort())
    const { model, calls, requests } = routedModel(({ userText, humanText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'AGAIN' ? 'REPORT-2' : 'REPORT-1')
      if (humanText === 'Delegate')
        return assistantReply([subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' })], 'toolUse')
      if (humanText === 'Again')
        return assistantReply(
          [toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'AGAIN' })],
          'toolUse'
        )
      return reply('OK.')
    })
    const { session } = await createTestSession({ stream: model, subagents: host.port })
    await session.prompt('Delegate')
    await session.prompt('Again')
    await waitFor(() => calls.some((call) => call.lastText.includes('REPORT-2')))

    expect(host.subagents[1].modelKey).toBe(`${DEFAULT_SUB.provider}/${DEFAULT_SUB.id}`)
    expect(new Set(childRequests(requests, session.sessionId).map((request) => request.model.id))).toEqual(
      new Set(['small-model'])
    )
  })

  // Breaks when the model gets a parameter the host cannot honor.
  it('offers no model parameter when the host cannot find models', async () => {
    const { model, calls } = delegating({})
    const { session } = await createTestSession({
      stream: model,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate')

    const tool = calls[0].options.tools?.find((candidate) => candidate.name === 'subagent')
    expect(tool?.parameters).toHaveProperty('properties', {
      description: expect.any(Object),
      prompt: expect.any(Object),
      fork: expect.any(Object),
      background: expect.any(Object)
    })
  })
})
