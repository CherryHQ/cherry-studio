import { mkdir, mkdtemp, rm, copyFile, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { InMemoryCredentialStore, type Message, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import {
  CURRENT_SESSION_VERSION,
  createAgentSession,
  createBashToolDefinition,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ProviderConfig,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { forkPiSession } from './piFork'
import { withPiToolResultReplay } from './piToolResultReplay'
import { createPiProviderExtension } from './providerExtension'

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

describe('Pi native tool result replay SDK contract', () => {
  it('repairs every continuation without rewriting the seeded native session', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'cherry-pi-replay-'))
    directories.push(cwd)
    const sessions = path.join(cwd, 'sessions')
    await mkdir(sessions)
    const captures: {
      raw: string
      status: number
      messages: { role: string; tool_call_id?: string; content?: unknown }[]
    }[] = []
    const replayed: Message[][] = []
    const server = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const { messages } = JSON.parse(raw)
      const invalid = messages.some(
        (message: { role: string; tool_call_id?: unknown }) =>
          message.role === 'tool' && typeof message.tool_call_id !== 'string'
      )
      const status = invalid ? 400 : 200
      captures.push({ raw, status, messages })
      if (invalid) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'missing field tool_call_id', type: 'json_parse_error' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
    try {
      const guardedStream = withPiToolResultReplay((model, context, options) =>
        streamSimple(model as Model<'openai-completions'>, context, options)
      )
      const config: ProviderConfig = {
        name: 'replay-fixture',
        api: 'cherry-replay-contract',
        apiKey: 'fixture',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: [
          {
            id: 'fixture',
            name: 'fixture',
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 100000,
            maxTokens: 1000
          }
        ],
        streamSimple: (model, context, options) => {
          replayed.push(context.messages)
          return guardedStream(model, context, options)
        }
      }
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false
      })
      modelRuntime.registerProvider('replay-fixture', config)
      await modelRuntime.setRuntimeApiKey('replay-fixture', 'fixture')
      const model = modelRuntime.getModel('replay-fixture', 'fixture')!
      const manager = SessionManager.create(cwd, sessions)
      manager.appendMessage({ role: 'user', content: 'seed', timestamp: 0 })
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call_a', name: 'read', arguments: { path: 'fixture' } }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 1
      })
      manager.appendMessage({
        role: 'toolResult',
        toolName: 'read',
        content: [{ type: 'text', text: 'SEEDED_REAL_OUTPUT' }],
        isError: false,
        timestamp: 2
      } as Message)
      const file = manager.getSessionFile()!
      const prefix = await readFile(file, 'utf8')
      expect(prefix.endsWith('\n')).toBe(true)
      const entries = prefix
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(entries[0]).toMatchObject({ type: 'session', version: CURRENT_SESSION_VERSION })
      expect(entries.at(-1).message).not.toHaveProperty('toolCallId')
      const open = async () => {
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } })
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir: cwd,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          extensionFactories: [createPiProviderExtension('replay-fixture', config)]
        })
        await resourceLoader.reload()
        return (
          await createAgentSession({
            cwd,
            agentDir: cwd,
            modelRuntime,
            model,
            settingsManager,
            resourceLoader,
            sessionManager: SessionManager.open(file, sessions, cwd),
            tools: []
          })
        ).session
      }
      session = await open()
      await session.prompt('first continuation')
      expect(session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'OK' }]
      })
      await session.prompt('second continuation')
      expect(session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'OK' }]
      })
      expect(replayed).toHaveLength(2)
      expect(
        replayed[1].some(
          (message) =>
            message.role === 'toolResult' &&
            message.toolCallId === undefined &&
            JSON.stringify(message.content).includes('SEEDED_REAL_OUTPUT')
        )
      ).toBe(true)
      session.dispose()
      session = await open()
      await session.prompt('reopened continuation')
      expect(session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'OK' }]
      })
      expect(captures.map(({ status }) => status)).toEqual([200, 200, 200])
      expect(replayed).toHaveLength(3)
      for (const capture of captures) {
        const tools = capture.messages.filter((message) => message.role === 'tool')
        expect(tools).toEqual([{ role: 'tool', tool_call_id: 'call_a', content: 'SEEDED_REAL_OUTPUT' }])
      }
      expect((await readFile(file)).subarray(0, Buffer.byteLength(prefix))).toEqual(Buffer.from(prefix))
      expect((await readFile(file, 'utf8')).length).toBeGreaterThan(prefix.length)
    } finally {
      session?.dispose()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
