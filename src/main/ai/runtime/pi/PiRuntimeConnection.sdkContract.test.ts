import { mkdir, mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { InMemoryCredentialStore, type ModelThinkingLevel } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import {
  createAgentSession,
  createBashToolDefinition,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { forkPiSession } from './piFork'
import { installPiRoundBudget } from './piRoundBudget'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function createSession(excludeTools?: string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'cherry-pi-sdk-contract-'))
  directories.push(cwd)
  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  })
  await resourceLoader.reload()
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const managedBash = createBashToolDefinition(cwd, { spawnHook: (context) => context }) as ToolDefinition
  const { session } = await createAgentSession({
    cwd,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    tools: ['bash'],
    customTools: [managedBash],
    excludeTools
  })
  return { managedBash, session }
}

describe('Pi managed Bash SDK contract', () => {
  it.each([false, true])('forks at the exact leaf (older duplicate: %s)', async (duplicate) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cherry-pi-native-fork-'))
    directories.push(directory)
    const sessions = path.join(directory, 'sessions')
    await mkdir(sessions)
    const originalPath = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
      key === 'feature.agents.pi.sessions' ? sessions : originalPath(key, ...args)
    )
    const manager = SessionManager.create(directory, sessions)
    if (duplicate)
      await writeFile(
        path.join(sessions, `2000-01-01T00-00-00-000Z_${manager.getSessionId()}.jsonl`),
        JSON.stringify(manager.getHeader()) + '\n'
      )
    manager.appendMessage({ role: 'user', content: 'PAST_ONLY', timestamp: 1 })
    manager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'COMPLETED_PAST' }],
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const checkpoint = {
      runtime: 'pi' as const,
      runtimeSessionId: manager.getSessionId(),
      leafId: manager.getLeafId()!
    }
    manager.appendMessage({ role: 'user', content: 'FUTURE_SECRET', timestamp: 3 })
    const sourceIdentity = { id: manager.getSessionId(), file: manager.getSessionFile(), leaf: manager.getLeafId() }
    let current = checkpoint
    for (const name of ['child', 'grandchild']) {
      const artifacts = path.join(directory, name)
      await mkdir(artifacts)
      const result = await forkPiSession({
        sourceSessionId: 'source',
        checkpoint: current,
        checkpoints: [current],
        targetSessionId: name,
        targetCwd: directory,
        artifactDirectory: artifacts,
        signal: new AbortController().signal
      })
      await copyFile(result.publish[0].source, result.publish[0].target)
      const child = SessionManager.open(result.publish[0].target, sessions, directory)
      expect(JSON.stringify(child.buildSessionContext().messages)).toContain('PAST_ONLY')
      expect(JSON.stringify(child.buildSessionContext().messages)).not.toContain('FUTURE_SECRET')
      expect({ id: manager.getSessionId(), file: manager.getSessionFile(), leaf: manager.getLeafId() }).toEqual(
        sourceIdentity
      )
      current = result.checkpoints[0] as typeof checkpoint
      if (name === 'child') await rm(sourceIdentity.file!)
    }
  })
  it('uses the managed custom definition when enabled and removes it when bash is excluded', async () => {
    const enabled = await createSession()

    try {
      const disabled = await createSession(['bash'])
      try {
        expect(enabled.session.getToolDefinition('bash')).toBe(enabled.managedBash)
        expect(enabled.session.getActiveToolNames()).toContain('bash')

        expect(disabled.session.getToolDefinition('bash')).toBeUndefined()
        expect(disabled.session.getActiveToolNames()).not.toContain('bash')
        expect(disabled.session.getAllTools().map((tool) => tool.name)).not.toContain('bash')
      } finally {
        disabled.session.dispose()
      }
    } finally {
      enabled.session.dispose()
    }
  })
})

async function createThinkingSession(
  thinkingLevel?: ModelThinkingLevel,
  sessionManager?: SessionManager,
  ultra = false,
  api: 'openai-completions' | 'openai-responses' = 'openai-completions'
) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'cherry-pi-thinking-contract-'))
  directories.push(cwd)
  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true
  })
  await resourceLoader.reload()
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider('thinking-fixture', {
    baseUrl: 'https://thinking.invalid/v1',
    api,
    apiKey: 'fixture-only',
    models: [
      {
        id: 'constrained',
        name: 'Constrained reasoning fixture',
        reasoning: true,
        input: ['text'],
        contextWindow: 32000,
        maxTokens: 1000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: 'low',
          medium: null,
          high: 'high',
          xhigh: null,
          max: 'max',
          ultra: ultra ? 'ultra' : null
        }
      }
    ]
  })
  await modelRuntime.setRuntimeApiKey('thinking-fixture', 'fixture-only')
  const manager = sessionManager ?? SessionManager.inMemory(cwd)
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: manager,
    model: modelRuntime.getModel('thinking-fixture', 'constrained'),
    tools: [],
    // Patched pi-ai supports ultra beyond the SDK's stale agent-core declaration.
    // @ts-expect-error ModelThinkingLevel includes ultra, which the installed SDK type omits.
    thinkingLevel
  })
  const efforts: unknown[] = []
  session.agent.streamFunction = (model, context, options) =>
    streamSimple(model, context, {
      ...options,
      apiKey: 'fixture-only',
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        efforts.push(api === 'openai-responses' ? body.reasoning.effort : body.reasoning_effort)
        if (api === 'openai-responses') {
          const event = {
            type: 'response.completed',
            response: { id: 'fixture-response', status: 'completed', output: [] }
          }
          return new Response(`event: response.completed\ndata: ${JSON.stringify(event)}\n\n`, {
            headers: { 'content-type': 'text/event-stream' }
          })
        }
        const chunk = {
          id: 'fixture-response',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'constrained',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }]
        }
        const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' }
        })
      }
    })
  return { session, manager, efforts }
}

describe('Pi reasoning selection SDK contract', () => {
  it.each(
    (
      [
        { selection: 'max', expected: 'max' },
        { selection: undefined, expected: 'high' },
        { selection: 'medium', expected: 'high' },
        { selection: 'ultra', expected: 'ultra' }
      ] satisfies Array<{ selection: ModelThinkingLevel | undefined; expected: string }>
    ).flatMap((row) => (['openai-completions', 'openai-responses'] as const).map((api) => ({ ...row, api })))
  )('keeps $selection at $expected in initial state and both $api requests', async ({ selection, expected, api }) => {
    const { session, manager, efforts } = await createThinkingSession(selection, undefined, selection === 'ultra', api)
    try {
      expect(session.thinkingLevel).toBe(expected)
      expect(manager.getBranch().find((entry) => entry.type === 'thinking_level_change')).toMatchObject({
        thinkingLevel: expected
      })
      await session.prompt('first')
      await session.prompt('second')
      expect(
        session.messages.filter((message) => message.role === 'assistant').map((message) => message.errorMessage)
      ).toEqual([undefined, undefined])
      expect(efforts).toEqual([expected, expected])
      const responses = session.messages.filter((message) => message.role === 'assistant')
      expect(responses).toHaveLength(2)
      for (const response of responses) {
        expect(response).toMatchObject({ thinkingLevel: expected, stopReason: 'stop' })
      }
      expect(session.thinkingLevel).toBe(expected)
    } finally {
      session.dispose()
    }
  })

  it.each(['max', undefined] as const)(
    'resumes high history with explicit %s precedence while preserving historical bookkeeping',
    async (selection) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'cherry-pi-thinking-resume-'))
      directories.push(directory)
      const manager = SessionManager.create(directory, directory)
      const original = await createThinkingSession('high', manager)
      await original.session.prompt('persist high history')
      original.session.dispose()
      const resumed = await createThinkingSession(
        selection,
        SessionManager.open(manager.getSessionFile()!, directory, directory)
      )
      try {
        await resumed.session.prompt('continue')
        expect(resumed.session.thinkingLevel).toBe(selection ?? 'high')
        expect(resumed.efforts).toEqual([selection ?? 'high'])
        expect(resumed.manager.getBranch().filter((entry) => entry.type === 'thinking_level_change')).toMatchObject([
          { thinkingLevel: 'high' }
        ])
      } finally {
        resumed.session.dispose()
      }
    }
  )
})

// Round-budget SDK contract (#23189): the production helper (installPiRoundBudget) is composed over
// the REAL session's own finishTurn boundary wrapper, exactly as PiRuntimeConnection wires it after
// bindExtensions. These tests are also the upgrade guard for the SDK's public finishTurn surface: if
// a pi-agent-core/pi-coding-agent bump changes the hook contract, this file fails before runtime does.
describe('Pi round budget SDK contract', () => {
  type RoundKind = 'invalidArgs' | 'unknownTool' | 'valid' | 'text' | 'mixedBatch'

  function sseResponse(kind: RoundKind, round: number): string {
    const base = { id: `r-${round}`, object: 'chat.completion.chunk', created: 1, model: 'loop' }
    const chunks =
      kind === 'text'
        ? [
            { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
            { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
          ]
        : [
            {
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls:
                      kind === 'mixedBatch'
                        ? [
                            {
                              index: 0,
                              id: `call-${round}-ok`,
                              type: 'function',
                              function: { name: 'bash', arguments: '{"command":"true"}' }
                            },
                            {
                              index: 1,
                              id: `call-${round}-bad`,
                              type: 'function',
                              function: { name: 'nosuchtool', arguments: '{}' }
                            }
                          ]
                        : [
                            {
                              index: 0,
                              id: `call-${round}`,
                              type: 'function',
                              function: {
                                name: kind === 'unknownTool' ? 'nosuchtool' : 'bash',
                                arguments: kind === 'invalidArgs' ? '{' : '{"command":"true"}'
                              }
                            }
                          ]
                  },
                  finish_reason: null
                }
              ]
            },
            { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
          ]
    return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  }

  async function createLoopSession(
    script: (round: number) => RoundKind,
    options?: {
      budgetLimit?: number
      onLimitReached?: () => void
      turnEnds?: { count: number }
      onRound?: (round: number) => Promise<void>
    }
  ) {
    const cwd = await mkdtemp(path.join(tmpdir(), 'cherry-pi-round-budget-'))
    directories.push(cwd)
    const settingsManager = SettingsManager.inMemory()
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi: { on: (event: string, handler: (e: never, c: never) => unknown) => void }) => {
          pi.on('turn_end', () => {
            if (options?.turnEnds) options.turnEnds.count += 1
          })
        }
      ] as never
    })
    await resourceLoader.reload()
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    modelRuntime.registerProvider('rounds-fixture', {
      baseUrl: 'https://rounds.invalid/v1',
      api: 'openai-completions',
      apiKey: 'fixture-only',
      models: [
        {
          id: 'loop',
          name: 'Loop fixture',
          reasoning: false,
          input: ['text'],
          contextWindow: 32000,
          maxTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
      ]
    })
    await modelRuntime.setRuntimeApiKey('rounds-fixture', 'fixture-only')
    const managedBash = createBashToolDefinition(cwd, { spawnHook: (context) => context }) as ToolDefinition
    const { session } = await createAgentSession({
      cwd,
      agentDir: cwd,
      modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd),
      model: modelRuntime.getModel('rounds-fixture', 'loop'),
      tools: ['bash'],
      customTools: [managedBash]
    })
    const requests: string[] = []
    session.agent.streamFunction = (model, context, streamOptions) =>
      streamSimple(model, context, {
        ...streamOptions,
        apiKey: 'fixture-only',
        fetch: async (_input, init) => {
          const round = requests.push(String(init?.body))
          await options?.onRound?.(round)
          return new Response(sseResponse(script(round), round), {
            headers: { 'content-type': 'text/event-stream' }
          })
        }
      })
    await session.bindExtensions({})
    const budget = options?.budgetLimit
      ? installPiRoundBudget(session.agent, options.budgetLimit, options.onLimitReached ?? (() => {}))
      : undefined
    return { session, requests, budget }
  }

  it.each(['invalidArgs', 'unknownTool'] as const)(
    'bounds an all-%s loop at exactly 20 rounds with a clean end',
    async (kind) => {
      const onLimitReached = vi.fn()
      const turnEnds = { count: 0 }
      const { session, requests } = await createLoopSession(() => kind, {
        budgetLimit: 20,
        onLimitReached,
        turnEnds
      })
      try {
        await session.prompt('loop forever')
        expect(requests).toHaveLength(20)
        expect(onLimitReached).toHaveBeenCalledTimes(1)
        // Every admitted/immediate tool result settled before the end: 20 error results, no abort.
        const toolResults = session.messages.filter((message) => message.role === 'toolResult')
        expect(toolResults).toHaveLength(20)
        expect(session.messages.some((message) => message.role === 'assistant' && message.errorMessage)).toBe(false)
        // The session's own turn_end boundary wrapper stayed composed through the budget wrapper.
        expect(turnEnds.count).toBe(20)
      } finally {
        session.dispose()
      }
    }
  )

  it('leaves an unbounded loop alone without the budget (red: invalid loop exceeds 20 requests)', async () => {
    const { session, requests } = await createLoopSession((round) => (round <= 25 ? 'invalidArgs' : 'text'))
    try {
      await session.prompt('loop forever')
      expect(requests.length).toBeGreaterThan(20)
      expect(requests).toHaveLength(26)
    } finally {
      session.dispose()
    }
  })

  it('lets 19 tool rounds plus a final text answer complete without tripping the limit', async () => {
    const onLimitReached = vi.fn()
    const { session, requests } = await createLoopSession((round) => (round <= 19 ? 'valid' : 'text'), {
      budgetLimit: 20,
      onLimitReached
    })
    try {
      await session.prompt('nineteen then answer')
      expect(requests).toHaveLength(20)
      expect(onLimitReached).not.toHaveBeenCalled()
      const assistants = session.messages.filter((message) => message.role === 'assistant')
      expect(assistants.at(-1)?.stopReason).toBe('stop')
      expect(assistants.at(-1)?.errorMessage).toBeFalsy()
      // All 19 rounds REALLY executed bash (no validation failures): admitted work runs to completion.
      const results = session.messages.filter((message) => message.role === 'toolResult') as Array<{
        isError?: boolean
      }>
      expect(results).toHaveLength(19)
      expect(results.every((result) => result.isError !== true)).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('stays silent when admission terminate hints end an oversized batch naturally', async () => {
    // Admission drives the agent-level beforeToolCall surface (agent-session.js _installAgentToolHooks
    // bridges extension tool_call handlers onto it); the block+terminate contract is asserted there.
    const onLimitReached = vi.fn()
    const gate = { calls: 0 }
    const { session, requests } = await createLoopSession(() => 'valid', {
      budgetLimit: 20,
      onLimitReached
    })
    session.agent.beforeToolCall = async () => {
      gate.calls += 1
      return { block: true, reason: 'blocked for test', terminate: true }
    }
    try {
      await session.prompt('blocked batch')
      // The hook is consulted (these args pass validation), the terminate hint ends the batch in one
      // round, and the round budget stays out of it.
      expect(gate.calls).toBe(1)
      expect(requests).toHaveLength(1)
      expect(onLimitReached).not.toHaveBeenCalled()
      expect(session.messages.filter((message) => message.role === 'toolResult')).toHaveLength(1)
    } finally {
      session.dispose()
    }
  })

  it('bounds mixed batches (valid + unknown tool in one message) and settles both members', async () => {
    const onLimitReached = vi.fn()
    const { session, requests } = await createLoopSession(() => 'mixedBatch', {
      budgetLimit: 20,
      onLimitReached
    })
    try {
      await session.prompt('mixed batch loop')
      expect(requests).toHaveLength(20)
      expect(onLimitReached).toHaveBeenCalledTimes(1)
      const results = session.messages.filter((message) => message.role === 'toolResult') as Array<{
        isError?: boolean
        toolName?: string
      }>
      // Every round settled BOTH members: the valid bash call really executed, the unknown tool errored.
      expect(results).toHaveLength(40)
      const bashResults = results.filter((result) => result.toolName === 'bash')
      expect(bashResults).toHaveLength(20)
      expect(bashResults.every((result) => result.isError !== true)).toBe(true)
      expect(results.filter((result) => result.toolName === 'nosuchtool').every((r) => r.isError === true)).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('delivers a steer queued at the budget end in the same prompt lifecycle (6th request)', async () => {
    // Explained lifecycle: rounds 1-5 call tools; the budget ends the run at round 5, which skips the
    // agent loop's own steering poll, so the steer stays queued; the session layer then sees
    // hasQueuedMessages() and runs a continuation whose initial steering poll delivers the steer in
    // request 6. The text script stops that round and the drained queue settles the prompt.
    const onLimitReached = vi.fn()
    let releaseFinalRound!: () => void
    const finalRoundGate = new Promise<void>((resolve) => {
      releaseFinalRound = resolve
    })
    const { session, requests } = await createLoopSession((round) => (round <= 5 ? 'valid' : 'text'), {
      budgetLimit: 5,
      onLimitReached,
      onRound: (round) => (round === 5 ? finalRoundGate : Promise.resolve())
    })
    try {
      const first = session.prompt('loop then steer')
      await vi.waitFor(() => expect(requests.length).toBe(5))
      await session.steer('steered-at-budget-end')
      await vi.waitFor(() => expect(session.pendingMessageCount).toBe(1))
      releaseFinalRound()
      await first
      expect(requests).toHaveLength(6)
      expect(requests[5]).toContain('steered-at-budget-end')
      expect(requests.slice(0, 5).some((body) => body.includes('steered-at-budget-end'))).toBe(false)
      expect(session.pendingMessageCount).toBe(0)
      expect(onLimitReached).toHaveBeenCalledTimes(1)
      expect(session.messages.some((message) => message.role === 'assistant' && message.errorMessage)).toBe(false)
    } finally {
      session.dispose()
    }
  })

  it('delivers a follow-up queued at the budget end after one empty continuation round (7th request)', async () => {
    // Explained lifecycle: same forced end at round 5, but the continuation drains steering first -
    // the steering queue is empty, so request 6 is an empty continuation round that stops on the text
    // script; only at that run's stop does the agent loop poll the follow-up queue, so the follow-up
    // is delivered in request 7. This mirrors the clean-SDK observation of one extra empty round.
    const onLimitReached = vi.fn()
    let releaseFinalRound!: () => void
    const finalRoundGate = new Promise<void>((resolve) => {
      releaseFinalRound = resolve
    })
    const { session, requests } = await createLoopSession((round) => (round <= 5 ? 'valid' : 'text'), {
      budgetLimit: 5,
      onLimitReached,
      onRound: (round) => (round === 5 ? finalRoundGate : Promise.resolve())
    })
    try {
      const first = session.prompt('loop then follow up')
      await vi.waitFor(() => expect(requests.length).toBe(5))
      await session.followUp('followup-at-budget-end')
      await vi.waitFor(() => expect(session.pendingMessageCount).toBe(1))
      releaseFinalRound()
      await first
      expect(requests).toHaveLength(7)
      expect(requests[5]).not.toContain('followup-at-budget-end')
      expect(requests[6]).toContain('followup-at-budget-end')
      expect(requests.slice(0, 5).some((body) => body.includes('followup-at-budget-end'))).toBe(false)
      expect(session.pendingMessageCount).toBe(0)
      expect(onLimitReached).toHaveBeenCalledTimes(1)
      expect(session.messages.some((message) => message.role === 'assistant' && message.errorMessage)).toBe(false)
    } finally {
      session.dispose()
    }
  })

  it('bounds a tool-calling continuation with the same budget, firing the limit callback again', async () => {
    // Explained lifecycle: the budget spans the whole prompt lifecycle (no reset between the initial
    // run and its continuation), so when the steered continuation at request 6 calls tools again, the
    // budget force-ends that round too and the callback fires a second time; production wiring keeps
    // it idempotent by latching a boolean until the prompt run settles.
    const onLimitReached = vi.fn()
    let releaseFinalRound!: () => void
    const finalRoundGate = new Promise<void>((resolve) => {
      releaseFinalRound = resolve
    })
    const { session, requests } = await createLoopSession(() => 'valid', {
      budgetLimit: 5,
      onLimitReached,
      onRound: (round) => (round === 5 ? finalRoundGate : Promise.resolve())
    })
    try {
      const first = session.prompt('loop then steer more tools')
      await vi.waitFor(() => expect(requests.length).toBe(5))
      await session.steer('keep-going')
      await vi.waitFor(() => expect(session.pendingMessageCount).toBe(1))
      releaseFinalRound()
      await first
      expect(requests).toHaveLength(6)
      expect(requests[5]).toContain('keep-going')
      expect(session.pendingMessageCount).toBe(0)
      expect(onLimitReached).toHaveBeenCalledTimes(2)
      const toolResults = session.messages.filter((message) => message.role === 'toolResult')
      expect(toolResults).toHaveLength(6)
      expect(session.messages.some((message) => message.role === 'assistant' && message.errorMessage)).toBe(false)
    } finally {
      session.dispose()
    }
  })
})
