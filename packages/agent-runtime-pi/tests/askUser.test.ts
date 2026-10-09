import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { type AskUserPort, type AskUserRequest, type AskUserResponse, createAskUserExtension } from '../src'
import { createTestSession, finish, hostStore, plain, scriptedModel, streamTextPort, textParts } from './support'
import { textOf, toolOutputs, toolResults } from './toolResults'

const question = (text: string, extra: Record<string, unknown> = {}) => ({
  question: text,
  header: 'Choice',
  options: [
    { label: 'Postgres', description: 'Relational' },
    { label: 'SQLite', description: 'Embedded' }
  ],
  ...extra
})

const askCall = (id: string, questions: unknown[]): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'AskUserQuestion',
  input: JSON.stringify({ questions })
})

const reply = (text: string) => [...textParts('t', text), finish('stop')]

/** A host fake: records every request and how many were open at once. */
function hostPort(respond: (request: AskUserRequest) => AskUserResponse | Promise<AskUserResponse>) {
  const requests: AskUserRequest[] = []
  let open = 0
  const state = { requests, maxOpen: 0 }
  const port: AskUserPort = {
    async ask(request) {
      requests.push(request)
      state.maxOpen = Math.max(state.maxOpen, ++open)
      try {
        return await respond(request)
      } finally {
        open--
      }
    }
  }
  return { port, state }
}

async function run(port: AskUserPort, scripts: LanguageModelV3StreamPart[][], host = hostStore()) {
  const { model, calls } = scriptedModel(scripts)
  const runtime = await createTestSession({
    port: streamTextPort(model).port,
    extensionFactories: [createAskUserExtension(port)],
    onEvent: host.onEvent
  })
  return { ...runtime, calls, host }
}

describe('ask-user extension', () => {
  it('hands the answers, notes and unanswered questions to the model and the details to the host', async () => {
    const questions = [
      question('Which database?'),
      question('Which features?', {
        multiSelect: true,
        options: [
          { label: 'Auth', description: 'Sign in' },
          { label: 'Billing', description: 'Payments' },
          { label: 'Search', description: 'Full text', preview: 'search box' }
        ]
      }),
      question('Deploy where?')
    ]
    const { port, state } = hostPort(() => ({
      status: 'answered',
      answers: { 'Which database?': 'Postgres', 'Which features?': 'Auth, Billing' },
      annotations: { 'Which database?': { notes: 'we already run it' } }
    }))
    const { session, calls } = await run(port, [[askCall('ask_1', questions), finish('tool-calls')], reply('OK.')])
    await session.prompt('Set up the app')

    expect(state.requests).toHaveLength(1)
    expect(state.requests[0]).toMatchObject({ toolCallId: 'ask_1' })
    expect(state.requests[0].questions.map((q) => q.multiSelect)).toEqual([false, true, false])

    const [result] = toolResults(session)
    expect(result.isError).toBe(false)
    expect(textOf(result)).toContain('"Which database?" = "Postgres" (user notes: we already run it)')
    expect(textOf(result)).toContain('"Which features?" = "Auth, Billing"')
    expect(textOf(result)).toContain('"Deploy where?" = (not answered)')
    expect(result.details).toEqual({
      questions: state.requests[0].questions,
      answers: { 'Which database?': 'Postgres', 'Which features?': 'Auth, Billing' },
      annotations: { 'Which database?': { notes: 'we already run it' } }
    })
    expect(toolOutputs(calls[1].prompt).ask_1).toEqual({ type: 'text', value: textOf(result) })
  })

  it.each<{ name: string; response: AskUserResponse; text: RegExp }>([
    {
      name: 'declined with feedback',
      response: { status: 'declined', feedback: ' Use Postgres, stop asking. ' },
      text: /dismissed the questions.*said:\nUse Postgres, stop asking\.$/s
    },
    {
      name: 'declined without feedback',
      response: { status: 'declined' },
      text: /dismissed the questions.*Wait for the user's instructions/
    },
    {
      name: 'unavailable',
      response: { status: 'unavailable' },
      text: /proceed without asking the user and state your assumptions/
    }
  ])('reports $name as an error result and lets the run continue', async ({ response, text }) => {
    const { port, state } = hostPort(() => response)
    const { session, calls } = await run(port, [
      [askCall('ask_1', [question('Which database?')]), finish('tool-calls')],
      reply('Going with SQLite.')
    ])
    await session.prompt('Set up the app')

    const [result] = toolResults(session)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(text)
    expect(result.details).toEqual({ questions: state.requests[0].questions, answers: {} })
    expect(calls).toHaveLength(2)
    expect(toolOutputs(calls[1].prompt).ask_1).toEqual({ type: 'error-text', value: textOf(result) })
  })

  it('stops waiting when the turn is aborted, withdraws the question and ignores a late answer', async () => {
    let asked!: () => void
    const waiting = new Promise<void>((resolve) => (asked = resolve))
    let answerLate!: (response: AskUserResponse) => void
    const { port, state } = hostPort(() => {
      asked()
      return new Promise((resolve) => (answerLate = resolve))
    })
    const { session, calls, host } = await run(port, [
      [
        askCall('ask_1', [question('Which database?')]),
        askCall('ask_2', [question('Deploy where?')]),
        finish('tool-calls')
      ],
      reply('unreachable')
    ])
    const turn = session.prompt('Set up the app')
    await waiting
    await session.abort()
    await turn

    expect(state.requests.map((request) => request.signal.aborted)).toEqual([true])
    const [result, ...rest] = toolResults(session)
    expect(rest).toEqual([])
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/withdrawn because the turn was aborted/)
    expect(host.events.filter((event) => event.type === 'turn-complete')).toMatchObject([{ aborted: true }])
    expect(calls).toHaveLength(1)

    const stored = host.entries.length
    answerLate({ status: 'answered', answers: { 'Which database?': 'Postgres' } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(toolResults(session)).toEqual([result])
    expect(host.entries).toHaveLength(stored)
  })

  it('asks the questions of one model step one at a time, in order', async () => {
    const { port, state } = hostPort(
      (request) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: 'answered', answers: { [request.questions[0].question]: 'SQLite' } }), 10)
        )
    )
    const { session } = await run(port, [
      [
        askCall('ask_1', [question('Which database?')]),
        askCall('ask_2', [question('Which cache?')]),
        finish('tool-calls')
      ],
      reply('OK.')
    ])
    await session.prompt('Set up the app')

    expect(state.maxOpen).toBe(1)
    expect(state.requests.map((request) => request.toolCallId)).toEqual(['ask_1', 'ask_2'])
    expect(toolResults(session).map((result) => [result.toolCallId, textOf(result)])).toEqual([
      ['ask_1', expect.stringContaining('"Which database?" = "SQLite"')],
      ['ask_2', expect.stringContaining('"Which cache?" = "SQLite"')]
    ])
  })

  it.each([
    {
      name: 'the same question twice',
      questions: [question('Which one?'), question('Which one?')],
      reason: /different question text/
    },
    {
      name: 'a single option',
      questions: [question('Which one?', { options: [{ label: 'A', description: 'a' }] })],
      reason: /options: must not have fewer than 2 items/
    },
    {
      name: 'five questions',
      questions: ['A?', 'B?', 'C?', 'D?', 'E?'].map((text) => question(text)),
      reason: /questions: must not have more than 4 items/
    }
  ])('rejects $name without showing the user anything', async ({ questions, reason }) => {
    const { port, state } = hostPort(() => ({ status: 'unavailable' }))
    const { session } = await run(port, [[askCall('ask_1', questions), finish('tool-calls')], reply('Sorry.')])
    await session.prompt('Set up the app')

    const [result] = toolResults(session)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(reason)
    expect(state.requests).toEqual([])
  })

  it('keeps an answered question and its details in the history of a rebuilt session', async () => {
    const { port } = hostPort(() => ({ status: 'answered', answers: { 'Which database?': 'Postgres' } }))
    const live = await run(port, [
      [askCall('ask_1', [question('Which database?')]), finish('tool-calls')],
      reply('Postgres it is.')
    ])
    await live.session.prompt('Set up the app')
    await live.dispose()

    const storedResult = live.host.entries.find((entry) => entry.kind === 'message' && entry.message.role === 'tool')
    expect(storedResult).toMatchObject({
      details: { questions: [{ question: 'Which database?' }], answers: { 'Which database?': 'Postgres' } }
    })

    const rebuilt = scriptedModel([reply('Postgres, as you said.')])
    const { session } = await createTestSession({
      port: streamTextPort(rebuilt.model).port,
      extensionFactories: [createAskUserExtension(hostPort(() => ({ status: 'unavailable' })).port)],
      transcript: plain(live.host.entries)
    })
    await session.prompt('Which database did I pick?')

    const prompt = rebuilt.calls[0].prompt
    expect(prompt.flatMap((message) => (message.role === 'assistant' ? message.content : []))).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'ask_1',
        input: { questions: [question('Which database?')] }
      })
    )
    expect(toolOutputs(prompt).ask_1).toEqual({
      type: 'text',
      value: expect.stringContaining('"Which database?" = "Postgres"')
    })
  })
})
