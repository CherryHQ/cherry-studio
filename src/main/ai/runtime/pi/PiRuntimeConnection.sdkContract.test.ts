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
