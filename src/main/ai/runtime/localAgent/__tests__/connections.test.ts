import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../../types'
import { AcpConnection } from '../AcpConnection'
import { CodexConnection } from '../CodexConnection'
import { LocalAgentAuthService } from '../LocalAgentAuthService'
import { listLocalAgentModels } from '../LocalRuntimeDriver'

const managedFiles = vi.hoisted(() => ({ read: vi.fn(), getPhysicalPath: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: managedFiles })
})

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: async () => ({ ...process.env }) }))

const fixture = fileURLToPath(new URL('./fixtures/localAgent.mjs', import.meta.url))
const input = { message: { data: { parts: [{ type: 'text', text: 'hello' }] } } } as AgentRuntimeUserInput

describe('local protocol processes', () => {
  let cwd: string
  const connections: Array<AcpConnection | CodexConnection> = []
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), 'local-agent-contract-'))
    vi.mocked(application.getPath).mockReturnValue(cwd)
  })
  afterEach(async () => {
    await Promise.all(connections.splice(0).map((connection) => connection.close()))
    await rm(cwd, { recursive: true, force: true })
  })

  function create(protocol: 'acp' | 'codex', scenario = 'normal', nativeModel?: string) {
    const config: LocalAgentConfiguration = {
      protocol,
      nativeModel,
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, protocol, scenario],
      env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
    }
    const connection =
      protocol === 'acp'
        ? new AcpConnection('session', 'agent', config)
        : new CodexConnection('session', 'agent', config)
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    const text = () =>
      events
        .flatMap((event) => (event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []))
        .join('')
    return { connection, events, drained, text }
  }

  it('redacts a supplied API key from native authentication failures before crossing IPC', async () => {
    const service = new LocalAgentAuthService()
    await expect(
      service.authenticate(
        'redaction-test',
        {
          protocol: 'acp',
          enabled: true,
          executableOverride: process.execPath,
          args: [fixture, 'acp', 'auth-secret'],
          env: { GEMINI_API_KEY: 'fixture-private-key' }
        },
        'oauth-personal'
      )
    ).rejects.toThrow('Rejected <redacted>')
  })

  it.each(['auth-terminal', 'auth-legacy-terminal'])(
    'does not report terminal setup as completed authentication: %s',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      await connection.start(cwd, undefined, true)
      expect(connection.localSessionInfo.protocolInfo?.authMethods).toEqual([
        { id: 'oauth-personal', name: 'Google', type: 'terminal' }
      ])
      await expect((connection as AcpConnection).authenticate('oauth-personal')).rejects.toThrow(
        'requires external setup'
      )
      const log = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
      expect(log).not.toContain('"method":"authenticate"')
    }
  )

  it('authenticates with advertised native IDs without creating a conversation', async () => {
    const { connection } = create('acp', 'auth-success')
    await connection.start(cwd, undefined, true)
    await (connection as AcpConnection).authenticate('oauth-personal')
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).toContain('"methodId":"oauth-personal"')
    expect(wire).not.toContain('session/new')
    await expect((connection as AcpConnection).authenticate('unknown')).rejects.toThrow(
      'Unsupported authentication method'
    )
  })

  it('preserves authentication failures and interrupts pending login when closed', async () => {
    const { connection } = create('acp', 'auth-rejected')
    await connection.start(cwd, undefined, true)
    await expect((connection as AcpConnection).authenticate('oauth-personal')).rejects.toThrow(
      'not available in your location'
    )
    const pending = create('acp', 'auth-pending').connection as AcpConnection
    await pending.start(cwd, undefined, true)
    const rejected = expect(pending.authenticate('oauth-personal')).rejects.toThrow()
    await pending.close()
    await rejected
  })

  it.each(['normal', 'embedded-files'])('sends image bytes and native file content in order (%s)', async (scenario) => {
    const { connection } = create('acp', scenario)
    await connection.start(cwd)
    const file = path.join(cwd, '说明 #1.txt')
    await writeFile(file, '附件内容：测试')
    const parts = [
      { type: 'text', text: 'Read both attachments' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aW1hZ2U=', filename: 'image.png' },
      { type: 'file', mediaType: 'text/plain', url: pathToFileURL(file).href, filename: '说明 #1.txt' }
    ]
    await connection.send({ message: { data: { parts } } } as AgentRuntimeUserInput)
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const prompt = wire.find((message) => message.method === 'session/prompt').params.prompt
    expect(prompt).toEqual([
      { type: 'text', text: 'Read both attachments' },
      { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
      scenario === 'embedded-files'
        ? {
            type: 'resource',
            resource: { uri: pathToFileURL(file).href, mimeType: 'text/plain', text: '附件内容：测试' }
          }
        : {
            type: 'resource_link',
            uri: pathToFileURL(file).href,
            mimeType: 'text/plain',
            name: '说明 #1.txt',
            size: Buffer.byteLength('附件内容：测试')
          }
    ])
  })

  it('resolves managed attachments by file entry ID instead of their stale URL', async () => {
    const { connection } = create('acp', 'embedded-files')
    await connection.start(cwd)
    const file = path.join(cwd, 'managed.json')
    managedFiles.getPhysicalPath.mockReturnValue(file)
    managedFiles.read.mockResolvedValue({
      content: Buffer.from('managed attachment content').toString('base64'),
      mime: 'application/json'
    })
    await connection.send({
      ...input,
      message: {
        ...input.message,
        data: {
          parts: [
            {
              type: 'file',
              mediaType: 'application/json',
              url: 'file:///stale/missing.txt',
              filename: 'note',
              providerMetadata: { cherry: { fileEntryId: 'managed-entry' } }
            }
          ]
        }
      }
    })
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(wire.find((message) => message.method === 'session/prompt').params.prompt).toEqual([
      {
        type: 'resource',
        resource: { uri: pathToFileURL(file).href, mimeType: 'application/json', text: 'managed attachment content' }
      }
    ])
  })

  it('embeds binary documents and empty text without corrupting their bytes', async () => {
    const { connection } = create('acp', 'embedded-files')
    await connection.start(cwd)
    const bytes = Buffer.from([0, 255, 128, 37, 80, 68, 70])
    await connection.send({
      message: {
        data: {
          parts: [
            {
              type: 'file',
              mediaType: 'application/pdf',
              url: `data:application/pdf;base64,${bytes.toString('base64')}`,
              filename: 'report.pdf'
            },
            { type: 'file', mediaType: 'text/plain', url: 'data:text/plain;base64,', filename: 'empty.txt' }
          ]
        }
      }
    } as AgentRuntimeUserInput)
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(wire.find((message) => message.method === 'session/prompt').params.prompt).toEqual([
      {
        type: 'resource',
        resource: { uri: 'urn:cherry:attachment:0', mimeType: 'application/pdf', blob: bytes.toString('base64') }
      },
      { type: 'resource', resource: { uri: 'urn:cherry:attachment:1', mimeType: 'text/plain', text: '' } }
    ])
  })

  it.each(['no-images', 'missing-file', 'directory', 'missing-image'])(
    'rejects unusable attachments before sending any prompt (%s)',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      await connection.start(cwd)
      const part =
        scenario === 'no-images'
          ? { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' }
          : {
              type: 'file',
              mediaType: scenario === 'missing-image' ? 'image/png' : 'text/plain',
              url: pathToFileURL(scenario === 'directory' ? cwd : path.join(cwd, 'missing')).href
            }
      await expect(connection.send({ message: { data: { parts: [part] } } } as AgentRuntimeUserInput)).rejects.toThrow()
      const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
      expect(wire).not.toContain('session/prompt')
    }
  )

  it.each(['mode', 'mode-legacy', 'mode-both'])(
    'switches advertised modes and restores native state (%s)',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      const acp = connection as AcpConnection
      await acp.start(cwd, 'native-session')
      const mode = acp.localSessionInfo.mode!
      expect(mode.currentValue).toBe('ask')
      await expect(acp.setMode(mode.id, 'invalid')).rejects.toThrow('no longer available')
      await acp.setMode(mode.id, 'plan')
      expect(acp.localSessionInfo.mode?.currentValue).toBe('plan')
      const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const request = wire.find(
        (message) => message.method === (scenario === 'mode-legacy' ? 'session/set_mode' : 'session/set_config_option')
      )
      expect(request.params).toMatchObject(
        scenario === 'mode-legacy' ? { modeId: 'plan' } : { configId: 'agent-mode', value: 'plan' }
      )
    }
  )

  it('keeps the confirmed mode when a change fails and removes withdrawn options', async () => {
    const failed = create('acp', 'mode-error').connection as AcpConnection
    await failed.start(cwd)
    await expect(failed.setMode('agent-mode', 'plan')).rejects.toThrow('Mode unavailable')
    expect(failed.localSessionInfo.mode?.currentValue).toBe('ask')
    const removed = create('acp', 'mode-removed').connection as AcpConnection
    await removed.start(cwd)
    await removed.setMode('agent-mode', 'plan')
    expect(removed.localSessionInfo.mode).toBeUndefined()
  })

  it('preserves thoughts, replaces plans, and merges partial tool details without replaying history', async () => {
    const { connection, events, drained } = create('acp', 'rich-output')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    await connection.close()
    await drained
    const chunks = events.flatMap((event) => (event.type === 'chunk' ? [event.chunk] : []))
    expect(chunks.filter((chunk) => chunk.type === 'reasoning-delta')).toEqual([
      expect.objectContaining({ delta: 'Inspect first' }),
      expect.objectContaining({ delta: 'Then answer' })
    ])
    expect(chunks.filter((chunk) => chunk.type === 'reasoning-start')).toHaveLength(2)
    expect(chunks.filter((chunk) => chunk.type === 'reasoning-end')).toHaveLength(2)
    const plans = chunks.flatMap((chunk) => (chunk.type === 'data-agent-plan' && 'data' in chunk ? [chunk] : []))
    expect(plans).toHaveLength(2)
    expect(plans[0].id).toBe(plans[1].id)
    expect(plans[1].data).toEqual({ entries: [{ content: 'Inspect', priority: 'high', status: 'completed' }] })
    const tools = chunks.filter((chunk) => chunk.type === 'tool-input-available')
    expect(tools.at(-1)).toMatchObject({
      toolCallId: 'edit',
      input: {
        localAcpTool: {
          title: 'Edit example',
          kind: 'edit',
          status: 'completed',
          rawInput: { path: '/example' },
          locations: [{ path: '/example', line: 2 }],
          content: [{ type: 'diff', path: '/example', oldText: 'old', newText: 'new' }]
        }
      }
    })
    expect(chunks.filter((chunk) => chunk.type === 'tool-output-available')).toHaveLength(1)
  })

  it('preserves mixed output order and failed tool content without merging it into text', async () => {
    const { connection, events, drained } = create('acp', 'rich-content')
    await connection.start(cwd)
    await connection.send(input)
    await connection.close()
    await drained
    const chunks = events.flatMap((event) => (event.type === 'chunk' ? [event.chunk] : []))
    const content = chunks.flatMap((chunk) => (chunk.type === 'data-acp-content' && 'data' in chunk ? [chunk] : []))
    expect(content.map((chunk) => chunk.data)).toEqual([
      { content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }, reasoning: false },
      { content: { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' }, reasoning: false },
      {
        content: {
          type: 'resource_link',
          uri: 'https://example.com/report',
          name: 'report',
          description: 'Result report'
        },
        reasoning: false
      },
      {
        content: {
          type: 'resource',
          resource: { uri: 'file:///example.txt', mimeType: 'text/plain', text: 'Embedded result' }
        },
        reasoning: false
      },
      { content: { type: 'resource', resource: { uri: 'file:///example.bin', blob: 'YmluYXJ5' } }, reasoning: false },
      { content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }, reasoning: true }
    ])
    expect(new Set(content.map((chunk) => chunk.id)).size).toBe(6)
    const text = chunks.filter((chunk) => chunk.type === 'text-delta')
    expect(text.map((chunk) => chunk.delta)).toEqual(['turn 1: ', 'Done'])
    expect(text[0].id).not.toBe(text[1].id)
    expect(chunks.indexOf(content[0])).toBeGreaterThan(chunks.indexOf(text[0]))
    expect(chunks.indexOf(content[5])).toBeLessThan(chunks.indexOf(text[1]))
    expect(chunks.filter((chunk) => chunk.type === 'tool-input-available').at(-1)).toMatchObject({
      toolCallId: 'output',
      input: {
        localAcpTool: {
          status: 'failed',
          content: expect.arrayContaining([
            { type: 'content', content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' } }
          ])
        }
      }
    })
    expect(chunks.filter((chunk) => chunk.type === 'tool-output-error')).toEqual([
      expect.objectContaining({ toolCallId: 'output', errorText: 'Read failed' })
    ])
  })

  it('closes a partial thought on interruption without starting another response', async () => {
    const { connection, events, drained } = create('acp', 'rich-cancel')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'chunk' && event.chunk.type === 'reasoning-delta')).toBe(true)
    )
    await connection.close()
    await sending
    await drained
    const chunks = events.flatMap((event) => (event.type === 'chunk' ? [event.chunk] : []))
    expect(chunks.filter((chunk) => chunk.type === 'reasoning-end')).toHaveLength(1)
    expect(chunks.filter((chunk) => chunk.type === 'reasoning-delta')).toHaveLength(1)
  })

  it('preserves restored thought settings when the native model already matches', async () => {
    const { connection } = create('acp', 'thought-resume', 'fixture-model')
    await connection.start(cwd, 'native-session')
    expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('balanced')
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(wire.some((message) => message.method === 'session/set_config_option')).toBe(false)
  })

  it('uses advertised thought option IDs and values and publishes confirmed state', async () => {
    const { connection, events } = create('acp', 'thought')
    await connection.start(cwd)
    const acp = connection as AcpConnection
    expect(acp.localSessionInfo.thoughtLevel).toMatchObject({
      id: 'reasoning-budget',
      currentValue: 'balanced',
      options: [
        { value: 'balanced', name: 'Balanced' },
        { value: 'deep', name: 'Deep' }
      ]
    })
    await expect(acp.setThoughtLevel('reasoning-budget', 'high')).rejects.toThrow('no longer available')
    await acp.setThoughtLevel('reasoning-budget', 'deep')
    expect(acp.localSessionInfo.thoughtLevel?.currentValue).toBe('deep')
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'local-session-info',
          info: expect.objectContaining({ thoughtLevel: expect.objectContaining({ currentValue: 'deep' }) })
        })
      )
    )
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.filter((message) => message.method === 'session/set_config_option').map((message) => message.params)
    ).toEqual([{ sessionId: 'native-session', configId: 'reasoning-budget', value: 'deep' }])
  })

  it('waits for a pending thought change before prompting and rejects concurrent changes', async () => {
    const { connection, events, text } = create('acp', 'thought-delayed')
    await connection.start(cwd)
    const changing = (connection as AcpConnection).setThoughtLevel('reasoning-budget', 'deep')
    await expect((connection as AcpConnection).setThoughtLevel('reasoning-budget', 'balanced')).rejects.toThrow('busy')
    await Promise.all([changing, connection.send(input)])
    await vi.waitFor(() => expect(text()).toBe('turn 1: hello'))
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('deep')
  })

  it('preserves the previous thought value on rejection and removes withdrawn options', async () => {
    const failed = create('acp', 'thought-error')
    await failed.connection.start(cwd)
    await expect((failed.connection as AcpConnection).setThoughtLevel('reasoning-budget', 'deep')).rejects.toThrow(
      'Reasoning unavailable'
    )
    expect(failed.connection.localSessionInfo.thoughtLevel?.currentValue).toBe('balanced')
    const removed = create('acp', 'thought-removed')
    await removed.connection.start(cwd)
    await (removed.connection as AcpConnection).setThoughtLevel('reasoning-budget', 'deep')
    expect(removed.connection.localSessionInfo.thoughtLevel).toBeUndefined()
  })

  it('selects legacy ACP models and prefers config options when both interfaces exist', async () => {
    const legacy = create('acp', 'legacy-models', 'legacy-model')
    await legacy.connection.start(cwd)
    expect(legacy.connection.localSessionInfo.models).toEqual([{ id: 'legacy-model', name: 'Legacy model' }])
    expect(legacy.connection.localSessionInfo.activeModel?.id).toBe('legacy-model')
    const modern = create('acp', 'both-models', 'fixture-model')
    await modern.connection.start(cwd)
    expect(modern.connection.localSessionInfo.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.filter((message) => message.method === 'session/set_model').map((message) => message.params.modelId)
    ).toEqual(['legacy-model'])
    expect(
      wire.filter((message) => message.method === 'session/set_config_option').map((message) => message.params.value)
    ).toEqual(['fixture-model'])
  })

  it.each([undefined, 'native-session'])(
    'keeps initial commands and config while suppressing replay (resume=%s)',
    async (resume) => {
      const { connection, events, text } = create('acp', 'initial-updates')
      await connection.start(cwd, resume)
      await vi.waitFor(() => expect(events.some((event) => event.type === 'supported-commands')).toBe(true))
      expect(events.filter((event) => event.type === 'supported-commands')).toEqual([
        { type: 'supported-commands', commands: [{ name: 'review', description: 'Review code', argumentHint: '' }] }
      ])
      expect(connection.localSessionInfo.activeModel?.id).toBe('updated-model')
      expect(text()).toBe('')
    }
  )

  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['max_turn_requests', 'length'],
    ['refusal', 'content-filter'],
    ['cancelled', undefined]
  ])('preserves termination semantics for %s', async (reason, finishReason) => {
    const { connection, events, drained } = create('acp', `stop:${reason}`)
    await connection.start(cwd)
    await connection.send(input)
    await connection.close()
    await drained
    const finishes = events.flatMap((event) =>
      event.type === 'chunk' && event.chunk.type === 'finish' ? [event.chunk.finishReason] : []
    )
    expect(finishes).toEqual(finishReason ? [finishReason] : [])
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([
      { type: 'turn-complete', ...(reason === 'cancelled' ? { cancelled: true } : {}) }
    ])
  })

  it('records advertised capabilities separately from successful protocol checks', async () => {
    const { connection } = create('acp')
    await connection.start(cwd, undefined, true)
    expect(connection.localSessionInfo.protocolInfo).toEqual({
      protocolVersion: 1,
      agent: { name: 'fixture', version: '1.0' },
      capabilities: { loadSession: true, promptCapabilities: { image: true } },
      authMethods: [],
      verified: ['handshake']
    })
  })

  it.each([undefined, 'native-session'])(
    'publishes current context snapshots from ACP creation or recovery: %s',
    async (resume) => {
      const { connection, events, drained } = create('acp', 'context-usage')
      await connection.start(cwd, resume)
      await connection.send(input)
      await connection.send(input)
      await connection.close()
      await drained
      const readings = events.flatMap((event) => (event.type === 'context-usage' ? [event.usage] : []))
      expect(readings).toEqual(
        [20, 40, 10].map((used) => ({
          categories: [],
          totalTokens: used,
          maxTokens: 100,
          percentage: used,
          model: 'fixture-default'
        }))
      )
      expect(events.filter((event) => event.type === 'usage')).toEqual([])
    }
  )

  it('records only reported prompt usage, includes cache and reasoning, and resets between turns', async () => {
    const { connection, events, drained } = create('acp', 'usage')
    await connection.start(cwd)
    await connection.send(input)
    await connection.send(input)
    await connection.close()
    await drained
    const invocations = events.flatMap((event) => (event.type === 'usage' ? [event.invocation] : []))
    expect(invocations).toHaveLength(2)
    expect(invocations[0].usage).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      noCacheTokens: 100,
      reasoningTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 10
    })
    expect(invocations[1].usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, noCacheTokens: 3 })
    expect(invocations[0].requestId).not.toBe(invocations[1].requestId)
    expect(
      invocations.every((invocation) => invocation.messageAssociation === 'current-turn' && !invocation.metrics)
    ).toBe(true)
  })

  it('does not invent usage when the agent omits it', async () => {
    const { connection, events, drained } = create('acp')
    await connection.start(cwd)
    await connection.send(input)
    await connection.close()
    await drained
    expect(events.filter((event) => event.type === 'usage' || event.type === 'context-usage')).toEqual([])
  })

  // Enumeration must not infer, apply a stale saved model, or create a Codex thread.
  it.each(['acp', 'codex'] as const)('%s loads real model IDs without sending a prompt', async (protocol) => {
    const catalog = await listLocalAgentModels({
      protocol,
      enabled: false,
      nativeModel: 'stale-model',
      executableOverride: process.execPath,
      args: [fixture, protocol, 'normal'],
      env: { FIXTURE_LOG: path.join(cwd, 'models.jsonl') }
    })
    expect(catalog.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
    const wire = (await readFile(path.join(cwd, 'models.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.some((message) =>
        ['session/prompt', 'turn/start', 'thread/start', 'session/set_config_option'].includes(message.method)
      )
    ).toBe(false)
  })

  it('keeps an empty catalog when an ACP agent does not advertise model selection', async () => {
    const { connection } = create('acp', 'no-models')
    await connection.start(cwd, undefined, 'models')
    expect(connection.localSessionInfo.models).toEqual([])
  })

  it.each(['acp', 'codex'] as const)('%s applies the selected native model on connection', async (protocol) => {
    const { connection } = create(protocol, 'normal', 'fixture-model')
    await connection.start(cwd)
    expect(connection.localSessionInfo.activeModel?.id).toBe('fixture-model')
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const request = wire.find(
      (message) => message.method === (protocol === 'acp' ? 'session/set_config_option' : 'thread/start')
    )
    expect(request.params).toMatchObject(
      protocol === 'acp' ? { configId: 'model', value: 'fixture-model' } : { model: 'fixture-model' }
    )
  })

  it.each(['acp', 'codex'] as const)('%s handshake never sends a prompt', async (protocol) => {
    const { connection } = create(protocol)
    await connection.start(cwd, undefined, true)
    await connection.close()
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      wire.some((message) => ['session/prompt', 'turn/start', 'thread/start', 'session/new'].includes(message.method))
    ).toBe(false)
    expect(wire[0].method).toBe('initialize')
  })

  it.each(['acp', 'codex'] as const)(
    '%s reuses its session for multiple turns and settles each once',
    async (protocol) => {
      const { connection, events, text } = create(protocol)
      await connection.start(cwd)
      await connection.send(input)
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))
      await connection.send(input)
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(2))
      expect(text()).toBe('turn 1: helloturn 2: hello')
      expect(connection.localSessionInfo.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
      expect(events.filter((event) => event.type === 'resume-token')).toEqual([
        { type: 'resume-token', token: 'native-session' }
      ])
    }
  )

  it('returns Cursor option IDs without conflating duplicate labels or splitting commas', async () => {
    const { connection, events, text } = create('acp', 'cursor-question')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing question')
    expect(approval.request.toolName).toBe('AskUserQuestion')
    expect(approval.request.input).toMatchObject({
      choiceOnly: true,
      questions: [{ id: 'features', multiSelect: true }]
    })
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { answerSelections: { features: ['two', 'one'] } }
    })
    await sending
    expect(text()).toContain(
      '"outcome":{"outcome":"answered","answers":[{"questionId":"features","selectedOptionIds":["two","one"]}]}'
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chunk',
        chunk: expect.objectContaining({
          type: 'tool-output-available',
          output: expect.objectContaining({ answers: { features: 'Same, label, Same, label' } })
        })
      })
    )
  })

  it.each([true, false])('returns the explicit Cursor plan decision: %s', async (approved) => {
    const { connection, events, text } = create('acp', 'cursor-plan')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing plan')
    expect(text()).toContain('## Plan')
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved })
    await sending
    expect(text()).toContain(`"outcome":{"outcome":"${approved ? 'accepted' : 'rejected'}"}`)
  })

  it.each(['cursor-question', 'cursor-plan'])('cancels %s on close without approval', async (scenario) => {
    const { connection, events } = create('acp', scenario)
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    await connection.close()
    await sending
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).toContain('"outcome":{"outcome":"cancelled"}')
    expect(toolApprovalRegistry.hasSession('session')).toBe(false)
  })

  it('preserves ACP permission option identity and scope', async () => {
    const { connection, events, text } = create('acp', 'permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
    expect(approval.request.input.localPermissionOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ optionId: 'always', kind: 'allow_always' })])
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'always' }
    })
    await sending
    expect(text()).toContain('"optionId":"always"')
    await vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === 'chunk' && event.chunk.type === 'tool-output-available')
      ).toHaveLength(1)
    )
  })

  it('settles a standalone ACP approval card even when the agent uses a separate execution tool ID', async () => {
    const { connection, events } = create('acp', 'standalone-permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    const approval = events.find((event) => event.type === 'tool-approval-request')!
    if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: false,
      updatedInput: { localPermissionOption: 'deny' }
    })
    await sending
    expect(events).toContainEqual({
      type: 'chunk',
      chunk: {
        type: 'tool-output-available',
        toolCallId: 'tool',
        output: { outcome: 'selected', optionId: 'deny' },
        dynamic: true
      }
    })
  })

  it.each(['acp', 'codex'] as const)('%s denies outstanding approvals on close', async (protocol) => {
    const { connection, events, drained } = create(protocol, 'permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    await connection.close()
    await sending
    await drained
    expect(toolApprovalRegistry.hasSession('session')).toBe(false)
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).not.toContain('"decision":"accept"')
    expect(wire).not.toContain('"optionId":"once"')
    expect(wire).toContain(protocol === 'acp' ? '"outcome":"cancelled"' : '"decision":"cancel"')
  })

  it.each(['acp', 'codex'] as const)('%s preserves partial text when the process crashes', async (protocol) => {
    const { connection, events, text } = create(protocol, 'crash')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'error')).toBe(true))
    expect(text()).toBe('turn 1: ')
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
  })

  it('performs declared file and terminal callbacks only after write/execution approval', async () => {
    const { connection, events, text } = create('acp', 'callbacks')
    await connection.start(cwd)
    const sending = connection.send(input)
    for (let index = 0; index < 2; index++) {
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(index + 1)
      )
      const approval = events.filter((event) => event.type === 'tool-approval-request')[index]
      if (approval.type !== 'tool-approval-request') throw new Error('Missing approval')
      if (index === 0) await expect(readFile(path.join(cwd, 'callback.txt'), 'utf8')).rejects.toThrow()
      else expect(text()).not.toContain('terminal-result')
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    }
    await sending
    expect(await readFile(path.join(cwd, 'callback.txt'), 'utf8')).toBe('line1\nline2\nline3')
    expect(text()).toBe('turn 1: line2terminal-result')
    await vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === 'chunk' && event.chunk.type === 'tool-output-available')
      ).toHaveLength(3)
    )
    const terminalInputs = events.flatMap((event) =>
      event.type === 'chunk' &&
      event.chunk.type === 'tool-input-available' &&
      event.chunk.toolCallId === 'terminal-tool'
        ? [event.chunk.input]
        : []
    )
    expect(terminalInputs.at(-1)).toMatchObject({
      localAcpTool: {
        status: 'completed',
        terminalDetails: expect.any(Object)
      }
    })
    expect(JSON.stringify(terminalInputs.at(-1))).toContain('terminal-result')
    const terminal = terminalInputs.at(-1) as { localAcpTool: { terminalDetails: Record<string, unknown> } }
    expect(Object.values(terminal.localAcpTool.terminalDetails)).toEqual([{ truncated: false, exitCode: 0 }])
  })

  it.each(['resume-only', 'resume-both', 'resume-null'])(
    'restores ACP state using negotiated capabilities: %s',
    async (scenario) => {
      const { connection, events, text } = create('acp', scenario)
      await connection.start(cwd, 'native-session')
      expect(connection.localSessionInfo).toMatchObject({
        resume: true,
        activeModel: { id: 'updated-model' },
        mode: { id: 'agent-mode', currentValue: 'ask' },
        thoughtLevel: { id: 'reasoning-budget', currentValue: 'balanced' }
      })
      await vi.waitFor(() =>
        expect(events).toContainEqual({
          type: 'supported-commands',
          commands: [{ name: 'review', description: 'Review code', argumentHint: '' }]
        })
      )
      await connection.send(input)
      expect(text()).toBe('turn 1: hello')
      const requests = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const restore = requests.filter(({ method }) =>
        ['session/load', 'session/resume', 'session/new'].includes(method)
      )
      expect(restore).toEqual([
        expect.objectContaining({
          method: scenario === 'resume-null' ? 'session/load' : 'session/resume',
          params: { sessionId: 'native-session', cwd, mcpServers: [] }
        })
      ])
    }
  )

  it('retains a failed restore instead of loading or creating a replacement conversation', async () => {
    const { connection } = create('acp', 'resume-error')
    await expect(connection.start(cwd, 'native-session')).rejects.toThrow('Native session was not found')
    const wire = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
    expect(wire).toContain('session/resume')
    expect(wire).not.toMatch(/session\/(new|load|prompt)/)
  })

  it.each(['close-ok', 'close-error', 'close-hang', 'close-null', 'normal'])(
    'releases the owned process after capability-gated close, including errors and timeout: %s',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      await connection.start(cwd)
      const pid = Number(await readFile(path.join(cwd, 'wire.jsonl.pid'), 'utf8'))
      await Promise.all([connection.close(), connection.close()])
      expect(() => process.kill(pid, 0)).toThrow()
      const requests = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter(({ method }) => method === 'session/close')).toEqual(
        scenario === 'normal' || scenario === 'close-null'
          ? []
          : [expect.objectContaining({ params: { sessionId: 'native-session' } })]
      )
    }
  )

  it('settles an active turn before protocol close and releases the process only once', async () => {
    const { connection, events, drained } = create('acp', 'close-active')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'chunk' && event.chunk.type === 'text-delta')).toBe(true)
    )
    await connection.close()
    await sending
    await drained
    const requests = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      requests.filter(({ method }) => ['session/cancel', 'session/close'].includes(method)).map(({ method }) => method)
    ).toEqual(['session/cancel', 'session/close'])
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
  })

  it('preserves grouped custom choices and boolean settings, and rejects removed or invalid options', async () => {
    const { connection } = create('acp', 'config-extra')
    await connection.start(cwd)
    const acp = connection as AcpConnection
    expect(acp.localSessionInfo.configOptions).toHaveLength(2)
    expect(acp.localSessionInfo.configOptions?.[0]).toMatchObject({
      name: 'Answer detail',
      description: 'Response length',
      options: [
        {
          group: 'detail',
          name: 'Detail levels',
          options: [
            { value: 'brief', name: 'Brief' },
            { value: 'verbose', name: 'Detailed', description: 'Include explanation' }
          ]
        }
      ]
    })
    await expect(acp.setConfigOption('verbosity', 'missing')).rejects.toThrow('no longer available')
    await expect(acp.setConfigOption('notifications', 'true')).rejects.toThrow('no longer available')
    await acp.setConfigOption('verbosity', 'verbose')
    await acp.setConfigOption('notifications', true)
    expect(acp.localSessionInfo.configOptions?.map((option) => option.currentValue)).toEqual(['verbose', true])
    await acp.send(input)
    expect(acp.localSessionInfo.configOptions).toEqual([])
    await expect(acp.setConfigOption('verbosity', 'brief')).rejects.toThrow('no longer available')
    const wire = (await readFile(path.join(cwd, 'wire.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(wire.filter(({ method }) => method === 'session/set_config_option').map(({ params }) => params)).toEqual([
      { sessionId: 'native-session', configId: 'verbosity', value: 'verbose' },
      { sessionId: 'native-session', configId: 'notifications', value: true }
    ])
  })

  it('keeps the previous custom setting when the agent rejects a change', async () => {
    const { connection } = create('acp', 'config-error')
    await connection.start(cwd)
    await expect((connection as AcpConnection).setConfigOption('verbosity', 'verbose')).rejects.toThrow(
      'Configuration rejected'
    )
    expect(connection.localSessionInfo.configOptions?.[0].currentValue).toBe('brief')
  })

  it.each([undefined, 'native-session'])(
    'receives native titles during setup and conversation without accepting other sessions: %s',
    async (resume) => {
      const { connection, events, drained } = create('acp', 'session-title')
      await connection.start(cwd, resume)
      await connection.send(input)
      await connection.close()
      await drained
      expect(events.filter((event) => event.type === 'session-title')).toEqual([
        { type: 'session-title', title: 'Native initial title' },
        { type: 'session-title', title: 'Native updated title' }
      ])
    }
  )

  it('suppresses ACP replay during load and rejects unsupported restore', async () => {
    const { connection, text } = create('acp')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    expect(text()).toBe('turn 1: hello')
    const unsupported = create('acp', 'no-resume').connection
    await expect(unsupported.start(cwd, 'native-session')).rejects.toThrow('cannot restore')
  })
})
