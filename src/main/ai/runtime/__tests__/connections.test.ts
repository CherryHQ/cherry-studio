import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentProviderService } from '@data/services/AgentProviderService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle'
import type * as ShellEnv from '@main/utils/shellEnv'
import {
  ACP_HOST_PERMISSION_MODE_ID,
  ACP_LAUNCH_BYPASS_VALUE,
  ACP_NATIVE_PLAN_VALUE,
  type LocalAgentConfiguration,
  LocalAgentModelCatalogSchema,
  LocalPermissionOptionsSchema
} from '@shared/ai/localAgent'
import { CodeCli } from '@shared/types/codeCli'

import { LocalAgentAuthService } from '../../../services/LocalAgentAuthService'
import { AcpConnection } from '../acp/AcpConnection'
import { connect as connectAcp } from '../acp/acpDriver'
import { isInjectedAcpAutomationTool } from '../acp/acpPermissionPolicy'
import { CodexSessionHost } from '../codex/CodexSessionHost'
import { enrichLocalAgentModels } from '../localAgentModelMetadata'
import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import { checkLocalAgent, listLocalAgentModels } from '../LocalRuntimeDriver'
import type { AgentRuntimeEvent, AgentRuntimeUserInput } from '../types'
import { localLaunch } from './fixtures/localLaunch'
import { observedParts } from './observedParts'

vi.mock('../../agentSession/localContext', () => ({
  localContext: () => ({ id: 'local-context', backendId: 'local-backend' }),
  localBindingMatches: () => true,
  bindLocalContext: (id: string, nativeThreadId: string) => ({ id, backendId: 'local-backend', nativeThreadId })
}))

const gateway = vi.hoisted(() => ({ acquireGateway: vi.fn() }))
const managedFiles = vi.hoisted(() => ({ read: vi.fn(), getPhysicalPath: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: managedFiles })
})

vi.mock('@main/utils/shellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellEnv>()),
  getRawShellEnv: async () => ({ ...process.env })
}))
vi.mock(import('@cherrystudio/agent-runtime-cursor'), async (importOriginal) => ({
  ...(await importOriginal()),
  listCursorModels: async () => [
    { id: 'opus-5.5', name: 'Claude Opus 5.5', description: 'Native description' },
    { id: 'composer-2.5', name: 'Composer 2.5' }
  ]
}))

const fixture = fileURLToPath(new URL('./fixtures/localAgent.mjs', import.meta.url))
const input = {
  message: { id: 'fixture-input', data: { parts: [{ type: 'text', text: 'hello' }] } }
} as AgentRuntimeUserInput

describe('local protocol processes', () => {
  let cwd: string
  const connections: Array<AcpConnection | CodexSessionHost> = []
  beforeEach(async () => {
    gateway.acquireGateway.mockReset().mockResolvedValue({
      url: 'ws://127.0.0.1:18790/ws',
      token: '',
      dispose: vi.fn().mockResolvedValue(undefined)
    })
    MockApplicationUtils.setService('OpenClawService', gateway)
    BaseService.resetInstances()
    cwd = await mkdtemp(path.join(tmpdir(), 'local-agent-contract-'))
    vi.mocked(application.getPath).mockReturnValue(cwd)
  })
  afterEach(async () => {
    await Promise.all(connections.splice(0).map((connection) => connection.close()))
    MockApplicationUtils.resetServices()
    await rm(cwd, { recursive: true, force: true })
  })

  async function readWire(filename = 'wire.jsonl') {
    return (await readFile(path.join(cwd, filename), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }

  function waitForApproval(events: AgentRuntimeEvent[], index = 0) {
    return vi.waitFor(() => {
      const approval = events.filter((event) => event.type === 'tool-approval-request')[index]
      expect(approval).toBeDefined()
      return approval
    })
  }

  function fixtureConfig(protocol: 'acp' | 'codex', scenario: string): LocalAgentConfiguration {
    return {
      presetId: protocol === 'codex' ? 'codex' : undefined,
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, protocol, scenario],
      env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
    }
  }

  function create(
    protocol: 'acp' | 'codex',
    scenario = 'normal',
    nativeModel?: string,
    presetId?: string,
    sourceModelId?: LocalAgentConfiguration['sourceModelId'],
    headless = false
  ) {
    const config = {
      ...fixtureConfig(protocol, scenario),
      ...(presetId ? { presetId } : {}),
      nativeModel,
      sourceModelId
    }
    const launch = localLaunch(config)
    const connection =
      protocol === 'acp'
        ? new AcpConnection('session', 'agent', launch.config, launch.target, headless)
        : new CodexSessionHost('session', 'agent', launch.config, launch.target, headless)
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    const text = () =>
      observedParts(events)
        .flatMap((part) => (part.type === 'append' && part.kind === 'text' ? [part.text] : []))
        .join('')
    async function closeAndDrain() {
      await connection.close()
      await drained
    }
    return { connection, events, drained, text, closeAndDrain }
  }

  it.each([
    ['pi-startup-late', 'pi-acp', undefined, 'OKpi v0.84.2\nUpdate available\n'],
    ['pi-startup-early', 'pi-acp', undefined, 'OKpi v0.84.2\nUpdate available\n'],
    ['pi-startup-missing', 'pi-acp', undefined, 'pi v0.84.2\nUpdate available\nOKpi v0.84.2\nUpdate available\n'],
    ['pi-startup-late', 'opencode', undefined, 'pi v0.84.2\nUpdate available\nOKpi v0.84.2\nUpdate available\n'],
    ['pi-startup-late', 'pi-acp', 'native-session', 'pi v0.84.2\nUpdate available\nOKpi v0.84.2\nUpdate available\n']
  ])(
    'preserves answers while excluding only Pi startup metadata (%s, %s, %s)',
    async (scenario, preset, resume, expected) => {
      const { connection, text, closeAndDrain } = create('acp', scenario, undefined, preset)
      await connection.start(cwd, resume)
      await connection.send(input)
      await closeAndDrain()
      expect(text()).toBe(expected)
    }
  )

  it('uses the Antigravity launch flag when the Agent requests bypass and ACP does not advertise it', async () => {
    const { config, target } = localLaunch({
      ...fixtureConfig('acp', 'antigravity-native-permissions'),
      presetId: 'antigravity-acp',
      args: ['acp']
    })
    await writeFile(
      path.join(cwd, 'acp'),
      `process.argv.splice(2, 0, 'acp', 'antigravity-native-permissions'); import(${JSON.stringify(pathToFileURL(fixture).href)})`
    )
    const connection = await connectAcp(
      {
        sessionId: 'session',
        agentId: 'agent',
        modelId: 'runtime:agent',
        localTarget: target,
        localPermissionMode: 'bypassPermissions'
      },
      config,
      cwd
    )
    connections.push(connection)
    expect(connection.localSessionInfo.launchPermission?.currentValue).toBe(ACP_LAUNCH_BYPASS_VALUE)
    const args = JSON.parse(await readFile(path.join(cwd, 'wire.jsonl.argv.json'), 'utf8'))
    expect(args).toContain('--dangerously-skip-permissions')
    expect((await readWire()).filter(({ method }) => method === 'initialize')).toHaveLength(2)
  })

  it('releases the OpenClaw Gateway after closing its ACP bridge', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    gateway.acquireGateway.mockResolvedValue({
      url: 'ws://127.0.0.1:18790/ws',
      token: 'private-gateway-token',
      dispose
    })
    const { connection, text, closeAndDrain } = create('acp', 'normal', undefined, 'openclaw')
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(text()).toContain('hello')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases a late OpenClaw lease when its connection has already closed', async () => {
    let resolve!: (value: unknown) => void
    gateway.acquireGateway.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const dispose = vi.fn().mockResolvedValue(undefined)
    const { connection } = create('acp', 'normal', undefined, 'openclaw')
    const starting = connection.start(cwd)
    const failed = expect(starting).rejects.toThrow()
    await vi.waitFor(() => expect(resolve).toBeDefined())
    await connection.close()
    resolve({ url: 'ws://127.0.0.1:18790/ws', token: '', dispose })
    await failed
    expect(dispose).toHaveBeenCalledTimes(1)
    await expect(readFile(path.join(cwd, 'wire.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('redacts a supplied API key from native authentication failures before crossing IPC', async () => {
    const service = new LocalAgentAuthService()
    await expect(
      service.authenticate(
        'redaction-test',
        {
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
      const config = fixtureConfig('acp', scenario)
      const result = await checkLocalAgent(config)
      expect(result.protocolInfo?.verified).toEqual(['handshake'])
      expect(result.protocolInfo?.authMethods).toEqual([{ id: 'oauth-personal', name: 'Google', type: 'terminal' }])
      await expect(
        new LocalAgentAuthService().authenticate('terminal-login', config, 'oauth-personal')
      ).rejects.toThrow('requires external setup')
      const log = await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')
      expect(log).not.toContain('"method":"authenticate"')
    }
  )

  it('authenticates with advertised native IDs without creating a conversation', async () => {
    const config = fixtureConfig('acp', 'auth-success')
    const service = new LocalAgentAuthService()
    await service.authenticate('success', config, 'oauth-personal')
    await expect(service.authenticate('unknown', config, 'unknown')).rejects.toThrow(
      'Unsupported authentication method'
    )
    const wire = await readWire()
    expect(wire.filter(({ method }) => method === 'authenticate').map(({ params }) => params.methodId)).toEqual([
      'oauth-personal'
    ])
    expect(wire.some(({ method }) => method === 'session/new')).toBe(false)
  })

  it('preserves native authentication failures', async () => {
    await expect(
      new LocalAgentAuthService().authenticate('failure', fixtureConfig('acp', 'auth-rejected'), 'oauth-personal')
    ).rejects.toThrow('not available in your location')
  })

  it.each(['cancel', 'stop'])('cleans up an outstanding authentication process on %s', async (action) => {
    const service = new LocalAgentAuthService()
    const config: LocalAgentConfiguration = {
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, 'acp', 'auth-pending'],
      env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
    }
    const outcome = service.authenticate('pending-test', config, 'oauth-personal').then(
      () => false,
      () => true
    )
    try {
      await vi.waitFor(async () =>
        expect((await readWire()).some((request) => request.method === 'authenticate')).toBe(true)
      )
      await expect(service.authenticate('pending-test', config, 'oauth-personal')).rejects.toThrow(
        'already in progress'
      )
      if (action === 'cancel') await service.cancel('pending-test')
      else await service._doStop()
      expect(await outcome).toBe(true)
      const pid = Number(await readFile(path.join(cwd, 'wire.jsonl.pid'), 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await service.cancel('pending-test')
    }
  })

  it('times out pending authentication and releases its owned process', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const service = new LocalAgentAuthService()
    const outcome = expect(
      service.authenticate(
        'timeout-test',
        {
          enabled: true,
          executableOverride: process.execPath,
          args: [fixture, 'acp', 'auth-pending'],
          env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
        },
        'oauth-personal'
      )
    ).rejects.toThrow('Authentication timed out')
    try {
      await vi.waitFor(async () =>
        expect((await readWire()).some((request) => request.method === 'authenticate')).toBe(true)
      )
      const deadline = timers.mock.calls.find(([, delay]) => delay === 300000)
      expect(deadline).toBeDefined()
      deadline![0]()
      await outcome
      const pid = Number(await readFile(path.join(cwd, 'wire.jsonl.pid'), 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      timers.mockRestore()
      await service.cancel('timeout-test')
    }
  })

  it.each(['normal', 'embedded-files'])('sends image bytes and native file content in order (%s)', async (scenario) => {
    const { connection } = create('acp', scenario)
    await connection.start(cwd)
    const file = path.join(cwd, '说明 #1.txt')
    await writeFile(file, '附件内容：测试')
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
    const parts = [
      { type: 'text', text: 'Read both attachments' },
      { type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${image}`, filename: 'image.png' },
      { type: 'file', mediaType: 'text/plain', url: pathToFileURL(file).href, filename: '说明 #1.txt' }
    ]
    await connection.send({ message: { data: { parts } } } as AgentRuntimeUserInput)
    const wire = await readWire()
    const prompt = wire.find((message) => message.method === 'session/prompt').params.prompt
    expect(prompt).toEqual([
      { type: 'text', text: 'Read both attachments' },
      // Main pads images below the minimum edge, so the wire carries a re-encoded PNG.
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
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

  it.each(['inline', 'managed'])('sends audio bytes in prompt order (%s)', async (source) => {
    const { connection } = create('acp', 'audio')
    await connection.start(cwd)
    expect(connection.localSessionInfo).toMatchObject({ audio: true })
    managedFiles.read.mockResolvedValue({ content: 'YXVkaW8=', mime: 'audio/wav' })
    const part = {
      type: 'file',
      mediaType: 'audio/wav',
      filename: 'clip.wav',
      url: source === 'inline' ? 'data:audio/wav;base64,YXVkaW8=' : 'file:///stale.wav',
      ...(source === 'managed' ? { providerMetadata: { cherry: { fileEntryId: 'managed-audio' } } } : {})
    }
    await connection.send({
      message: { data: { parts: [{ type: 'text', text: 'Listen' }, part] } }
    } as AgentRuntimeUserInput)
    const wire = await readWire()
    expect(wire.find(({ method }) => method === 'session/prompt').params.prompt).toEqual([
      { type: 'text', text: 'Listen' },
      { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' }
    ])
  })

  it.each(['normal', 'audio'])(
    'rejects unsupported or unreadable audio before sending a prompt (%s)',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      await connection.start(cwd)
      await expect(
        connection.send({
          message: {
            data: {
              parts: [
                {
                  type: 'file',
                  mediaType: 'audio/wav',
                  filename: 'missing.wav',
                  url: 'file:///missing-acp-audio.wav'
                }
              ]
            }
          }
        } as AgentRuntimeUserInput)
      ).rejects.toThrow(scenario === 'normal' ? 'does not support audio' : 'missing.wav')
      expect(await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')).not.toContain('session/prompt')
    }
  )

  it.each([undefined, 'native-session'])(
    'keeps notices out of message content and isolates sessions (%s)',
    async (resume) => {
      const { connection, events, closeAndDrain, text } = create('acp', 'notices')
      await connection.start(cwd, resume)
      await connection.send(input)
      await closeAndDrain()
      expect(events.filter((event) => event.type === 'notice')).toEqual([
        { type: 'notice', notice: { severity: 'warning', title: 'Quota low', description: 'Check account' } },
        { type: 'notice', notice: { severity: 'error', title: 'Connection degraded' } },
        { type: 'notice', notice: { severity: 'info', title: 'Agent information' } }
      ])
      expect(text()).toBe('turn 1: hello')
    }
  )

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
    const wire = await readWire()
    expect(wire.find((message) => message.method === 'session/prompt').params.prompt).toEqual([
      {
        type: 'resource',
        resource: { uri: pathToFileURL(file).href, mimeType: 'application/json', text: 'managed attachment content' }
      }
    ])
  })

  it('embeds binary documents and GBK text without corrupting their bytes, and keeps empty text', async () => {
    const { connection } = create('acp', 'embedded-files')
    await connection.start(cwd)
    const bytes = Buffer.from([0, 255, 128, 37, 80, 68, 70])
    const gbk = Buffer.from('c4e3bac3', 'hex').toString('base64')
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
            { type: 'file', mediaType: 'text/plain', url: 'data:text/plain;base64,', filename: 'empty.txt' },
            { type: 'file', mediaType: 'text/plain', url: `data:text/plain;base64,${gbk}`, filename: 'gbk.txt' }
          ]
        }
      }
    } as AgentRuntimeUserInput)
    const wire = await readWire()
    expect(wire.find((message) => message.method === 'session/prompt').params.prompt).toEqual([
      {
        type: 'resource',
        resource: { uri: 'urn:cherry:attachment:0', mimeType: 'application/pdf', blob: bytes.toString('base64') }
      },
      { type: 'resource', resource: { uri: 'urn:cherry:attachment:1', mimeType: 'text/plain', text: '' } },
      { type: 'resource', resource: { uri: 'urn:cherry:attachment:2', mimeType: 'text/plain', blob: gbk } }
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

  it.each(['mode', 'mode-legacy', 'mode-legacy-null', 'mode-both'])(
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
        (message) =>
          message.method === (scenario.startsWith('mode-legacy') ? 'session/set_mode' : 'session/set_config_option')
      )
      expect(request.params).toMatchObject(
        scenario.startsWith('mode-legacy') ? { modeId: 'plan' } : { configId: 'agent-mode', value: 'plan' }
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
    const { connection, events, closeAndDrain } = create('acp', 'rich-output')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    await closeAndDrain()
    const chunks = observedParts(events)
    expect(chunks.filter((chunk) => chunk.type === 'append' && chunk.kind === 'reasoning')).toEqual([
      expect.objectContaining({ text: 'Inspect first' }),
      expect.objectContaining({ text: 'Then answer' })
    ])
    expect(chunks.filter((chunk) => chunk.type === 'open' && chunk.kind === 'reasoning')).toHaveLength(2)
    expect(chunks.filter((chunk) => chunk.type === 'finish' && chunk.kind === 'reasoning')).toHaveLength(2)
    const plans = chunks.flatMap((chunk) => (chunk.type === 'data-agent-plan' && 'data' in chunk ? [chunk] : []))
    expect(plans).toHaveLength(2)
    expect(plans[0].id).toBe(plans[1].id)
    expect(plans[1].data).toEqual({ entries: [{ content: 'Inspect', priority: 'high', status: 'completed' }] })
    const tools = chunks.filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'input-available')
    expect(tools).toContainEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          localAcpTool: expect.objectContaining({ name: 'edit_file', status: 'in_progress' })
        })
      })
    )
    expect(
      chunks.findLast((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-available')
    ).toMatchObject({
      toolCallId: 'edit',
      input: {
        localAcpTool: {
          title: 'Edit example',
          name: 'apply_edit',
          kind: 'edit',
          status: 'completed',
          rawInput: { path: '/example' },
          locations: [
            { path: '/example', line: 2 },
            { path: '/example', line: null }
          ],
          resultField: 'content',
          diffPaths: ['/example']
        }
      },
      output: [{ type: 'diff', path: '/example', oldText: 'old', newText: 'new' }]
    })
    expect(chunks.filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-available')).toHaveLength(
      1
    )
  })

  it('preserves mixed output order and failed tool content without merging it into text', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'rich-content')
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    const chunks = observedParts(events)
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
    const text = chunks.flatMap((chunk) => (chunk.type === 'append' && chunk.kind === 'text' ? [chunk] : []))
    expect(text.map((chunk) => chunk.text)).toEqual(['turn 1: ', 'Done'])
    expect(text[0].part).not.toBe(text[1].part)
    expect(chunks.indexOf(content[0])).toBeGreaterThan(chunks.indexOf(text[0]))
    expect(chunks.indexOf(content[5])).toBeLessThan(chunks.indexOf(text[1]))
    expect(
      chunks.filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-error').at(-1)
    ).toMatchObject({
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
    expect(chunks.filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-error')).toEqual([
      expect.objectContaining({ toolCallId: 'output', errorText: 'Read failed' })
    ])
  })

  it('closes a partial thought on interruption without starting another response', async () => {
    const { connection, events, drained } = create('acp', 'rich-cancel')
    await connection.start(cwd)
    const sending = connection.send(input)
    await vi.waitFor(() =>
      expect(observedParts(events).some((chunk) => chunk.type === 'append' && chunk.kind === 'reasoning')).toBe(true)
    )
    await connection.close()
    await sending
    await drained
    const chunks = observedParts(events)
    expect(chunks.filter((chunk) => chunk.type === 'finish' && chunk.kind === 'reasoning')).toHaveLength(1)
    expect(chunks.filter((chunk) => chunk.type === 'append' && chunk.kind === 'reasoning')).toHaveLength(1)
  })

  it('preserves restored thought settings when the native model already matches', async () => {
    const { connection } = create('acp', 'thought-resume', 'fixture-model')
    await connection.start(cwd, 'native-session')
    expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('balanced')
    const wire = await readWire()
    expect(wire.some((message) => message.method === 'session/set_config_option')).toBe(false)
  })

  it('keeps setup option notifications across model selection without reopening a replayed compaction', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'model-setup-update', 'fixture-model')
    await connection.start(cwd, 'native-session')
    await closeAndDrain()
    expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('balanced')
    expect(events.filter((event) => event.type.startsWith('compaction-'))).toEqual([])
  })

  it.each(['thought-legacy-duplicate', 'thought-legacy-distinct'])(
    'prefers configOptions over legacy modes regardless of matching labels (%s)',
    async (scenario) => {
      const { connection } = create('acp', scenario)
      const acp = connection as AcpConnection
      await acp.start(cwd)
      expect(acp.localSessionInfo.mode).toBeUndefined()
      await acp.setThoughtLevel('reasoning-budget', 'deep')
      expect(acp.localSessionInfo.thoughtLevel?.currentValue).toBe('deep')
      expect(acp.localSessionInfo.mode).toBeUndefined()
    }
  )

  it('writes Pi legacy thinking levels through native set_mode without publishing permission choices', async () => {
    const { connection } = create('acp', 'thought-legacy-only', undefined, 'pi-acp')
    const acp = connection as AcpConnection
    await acp.start(cwd)
    expect(acp.localSessionInfo.mode).toBeUndefined()
    await acp.setThoughtLevel('legacy-mode', 'deep')
    expect(acp.localSessionInfo.thoughtLevel?.currentValue).toBe('deep')
    expect((await readWire()).find(({ method }) => method === 'session/set_mode')?.params).toMatchObject({
      modeId: 'deep'
    })
  })

  it('treats an empty configOptions list as authoritative', async () => {
    const acp = create('acp', 'mode-legacy-empty').connection as AcpConnection
    await acp.start(cwd)
    expect(acp.localSessionInfo.mode).toBeUndefined()
    await expect(acp.setMode('legacy-mode', 'plan')).rejects.toThrow('no longer available')
  })

  it('stops using legacy modes when configOptions arrive in an update', async () => {
    const acp = create('acp', 'mode-legacy-upgrade').connection as AcpConnection
    await acp.start(cwd)
    expect(acp.localSessionInfo.mode?.currentValue).toBe('ask')
    await acp.setMode('legacy-mode', 'plan')
    expect(acp.localSessionInfo.mode).toBeUndefined()
    expect(acp.localSessionInfo.thoughtLevel?.currentValue).toBe('balanced')
    await acp.setThoughtLevel('reasoning-budget', 'deep')
    expect(acp.localSessionInfo.thoughtLevel?.currentValue).toBe('deep')
    expect(acp.localSessionInfo.mode).toBeUndefined()
  })

  it('keeps the newly advertised mode when a legacy set_mode reply arrives after config_option_update', async () => {
    const acp = create('acp', 'mode-legacy-upgrade-with-mode').connection as AcpConnection
    await acp.start(cwd)
    await acp.setMode('legacy-mode', 'plan')
    expect(acp.localSessionInfo.mode).toMatchObject({ id: 'legacy-mode', currentValue: 'ask' })
    expect(acp.localSessionInfo.configOptions).toContainEqual(
      expect.objectContaining({
        category: 'mode',
        id: 'legacy-mode',
        currentValue: 'ask'
      })
    )
  })

  it.each([
    ['thought', 'reasoning-budget'],
    ['thought-uncategorized', 'effort']
  ])('applies and publishes the advertised ACP effort (%s)', async (scenario, configId) => {
    const { connection, events } = create('acp', scenario)
    await connection.start(cwd)
    const acp = connection as AcpConnection
    expect(acp.localSessionInfo.thoughtLevel).toMatchObject({
      id: configId,
      currentValue: 'balanced',
      options: [
        { value: 'balanced', name: 'Balanced' },
        { value: 'deep', name: 'Deep' }
      ]
    })
    await expect(acp.setThoughtLevel(configId, 'high')).rejects.toThrow('no longer available')
    await acp.setThoughtLevel(configId, 'deep')
    expect(acp.localSessionInfo.thoughtLevel).toMatchObject({ currentValue: 'deep', modelId: 'fixture-default' })
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'local-session-info',
          info: expect.objectContaining({ thoughtLevel: expect.objectContaining({ currentValue: 'deep' }) })
        })
      )
    )
    const wire = await readWire()
    expect(
      wire.filter((message) => message.method === 'session/set_config_option').map((message) => message.params)
    ).toEqual([{ sessionId: 'native-session', configId, value: 'deep' }])
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
    expect(legacy.connection.localSessionInfo.models).toEqual([
      {
        id: 'legacy-model',
        name: 'Legacy model',
        description: 'Legacy model description',
        _meta: { fixture: { modalities: ['text'] } }
      }
    ])
    expect(legacy.connection.localSessionInfo.activeModel?.id).toBe('legacy-model')
    const modern = create('acp', 'both-models', 'fixture-model')
    await modern.connection.start(cwd)
    expect(modern.connection.localSessionInfo.models).toEqual([
      {
        id: 'fixture-model',
        name: 'Fixture model',
        description: 'Live model description',
        _meta: { fixture: { modalities: ['image'] } }
      }
    ])
    const wire = await readWire()
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
      const { connection, events, text, closeAndDrain } = create('acp', 'initial-updates')
      await connection.start(cwd, resume)
      await closeAndDrain()
      expect(events.filter((event) => event.type === 'supported-commands')).toEqual([
        { type: 'supported-commands', commands: [{ name: 'review', description: 'Review code', argumentHint: '' }] }
      ])
      expect(connection.localSessionInfo.activeModel?.id).toBe('updated-model')
      expect(
        events.filter((event) => event.type === 'local-session-info').map(({ info }) => info.activeModel?.id)
      ).toEqual(['updated-model'])
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
    const { connection, events, closeAndDrain } = create('acp', `stop:${reason}`)
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    const finishes = events.flatMap((event) =>
      event.type === 'turn-complete' && event.finishReason ? [event.finishReason] : []
    )
    expect(finishes).toEqual(finishReason ? [finishReason] : [])
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([
      { type: 'turn-complete', ...(reason === 'cancelled' ? { status: 'paused' } : { finishReason }) }
    ])
  })

  it.each(['max_tokens', 'max_turn_requests', 'refusal'])(
    'fails an unattended ACP turn stopped by %s and keeps partial output',
    async (reason) => {
      const { connection, events, closeAndDrain, text } = create(
        'acp',
        `stop:${reason}`,
        undefined,
        undefined,
        undefined,
        true
      )
      await connection.start(cwd)
      await connection.send(input)
      await closeAndDrain()
      expect(text()).toContain('hello')
      expect(events.some((event) => event.type === 'error')).toBe(true)
      expect(events.some((event) => event.type === 'turn-complete')).toBe(false)
    }
  )

  it.each([undefined, 'native-session'])(
    'publishes current context snapshots from ACP creation or recovery: %s',
    async (resume) => {
      const { connection, events, closeAndDrain } = create('acp', 'context-usage')
      await connection.start(cwd, resume)
      await connection.send(input)
      await connection.send(input)
      await closeAndDrain()
      const readings = events.flatMap((event) =>
        event.type === 'context-usage' && event.result.status === 'confirmed' ? [event.result.value] : []
      )
      expect(readings).toEqual(
        [20, 40, 10].map((used) => ({
          model: 'fixture-default',
          revision: 'fixture-default',
          contextWindow: 100,
          basis: 'current-context',
          used: { tokens: used, precision: 'reported' }
        }))
      )
      expect(events.filter((event) => event.type === 'usage')).toEqual([])
    }
  )

  it.each([undefined, 'native-session'])(
    'retains cumulative costs independently of context and invocation usage: %s',
    async (resume) => {
      const { connection, events, closeAndDrain } = create('acp', 'session-cost')
      await connection.start(cwd, resume)
      await connection.send(input)
      await closeAndDrain()
      const snapshots = events.flatMap((event) => (event.type === 'session-cost' ? [event.snapshot] : []))
      expect(snapshots.map((snapshot) => snapshot.cost)).toEqual([
        { amount: 0.4, currency: 'EUR' },
        { amount: 0.4, currency: 'EUR' },
        { amount: 0.25, currency: 'EUR' },
        { amount: 0, currency: 'CNY' }
      ])
      expect(
        snapshots.every((snapshot) => snapshot.nativeSessionId === 'native-session' && snapshot.reportedAt > 0)
      ).toBe(true)
      expect(events.filter((event) => event.type === 'usage')).toEqual([])
    }
  )

  it('records only reported prompt usage, includes cache and reasoning, and resets between turns', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'usage')
    await connection.start(cwd)
    await connection.send(input)
    await connection.send(input)
    await closeAndDrain()
    const invocations = events.flatMap((event) => (event.type === 'local-turn-usage' ? [event.summary] : []))
    expect(invocations).toHaveLength(2)
    expect(invocations[0].usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      noCacheTokens: 50,
      reasoningTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 10
    })
    expect(invocations[1].usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, noCacheTokens: 3 })
    expect(invocations.every((summary) => summary.nativeSessionId && summary.correlation === 'unknown')).toBe(true)
    expect(events.filter((event) => event.type === 'usage')).toEqual([])
  })

  it('applies Grok legacy effort to the active native model and hides it for an unsupported model', async () => {
    const { connection } = create('acp', 'grok-legacy-effort', undefined, 'grok-build')
    await connection.start(cwd)
    const effort = connection.localSessionInfo.thoughtLevel
    expect(effort).toMatchObject({ modelId: 'grok-reasoning', currentValue: 'medium' })
    if (!effort) throw new Error('Missing Grok effort')
    const applied = await (connection as AcpConnection).setThoughtLevel(effort.id, 'xhigh')
    expect(applied.thoughtLevel?.currentValue).toBe('xhigh')

    const unsupported = create('acp', 'grok-legacy-effort', 'grok-basic', 'grok-build').connection
    await unsupported.start(cwd)
    expect(unsupported.localSessionInfo.activeModel?.id).toBe('grok-basic')
    expect(unsupported.localSessionInfo.thoughtLevel).toBeUndefined()
    const wire = await readWire()
    expect(wire.filter(({ method }) => method === 'session/set_model').map(({ params }) => params)).toEqual([
      { sessionId: 'native-session', modelId: 'grok-reasoning', _meta: { reasoningEffort: 'xhigh' } },
      { sessionId: 'native-session', modelId: 'grok-basic' }
    ])
  })

  it('reads suggestions from the bound Grok session and drops a response for an older request', async () => {
    const { connection, closeAndDrain } = create('acp', 'grok-prediction', undefined, 'grok-build')
    const grok = connection as AcpConnection
    await grok.start(cwd)
    const signal = new AbortController().signal
    expect(await grok.predictPrompt?.(signal)).toBe('run the tests')
    expect(await grok.predictPrompt?.(signal)).toBe('')
    await closeAndDrain()
  })

  it('answers the original Grok question with exact labels, notes and option previews', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'grok-question', undefined, 'grok-build')
    await connection.start(cwd)
    const sending = connection.send(input)
    const { request } = await waitForApproval(events)
    expect(request).toMatchObject({
      toolName: 'AskUserQuestion',
      toolCallId: 'grok-interaction',
      input: { responseMode: 'native-request' }
    })
    toolApprovalRegistry.dispatch(request.approvalId, {
      approved: true,
      updatedInput: {
        selections: [{ selected: ['A, B', 'C'] }, { selected: [], notes: 'Because' }, { selected: ['Show'] }],
        answers: { 'Which?': 'A, B, C', 'Why?': 'Because', 'Preview?': 'Show' }
      }
    })
    await sending
    await closeAndDrain()
    expect((await readWire()).find((message) => message.id === 'callback-1')?.result).toEqual({
      outcome: 'accepted',
      answers: { 'Which?': ['A, B', 'C'], 'Why?': ['Other'], 'Preview?': ['Show'] },
      annotations: { 'Why?': { notes: 'Because' }, 'Preview?': { preview: 'Diagram' } }
    })
    const last = observedParts(events)
      .filter((part) => part.type === 'dynamic-tool' && part.toolCallId === request.toolCallId)
      .at(-1)
    expect(last).toMatchObject({
      toolName: 'AskUserQuestion',
      state: 'output-available',
      output: { answers: { 'Why?': 'Because' } }
    })
  })

  it.each([
    [{ approved: true }, { outcome: 'approved' }],
    [
      { approved: false, reason: 'Change the release date', reasonSource: 'user' },
      { outcome: 'cancelled', feedback: 'Change the release date' }
    ],
    [{ approved: false, reasonSource: 'user' }, { outcome: 'abandoned' }],
    [{ approved: false, reason: 'The runtime closed' }, { outcome: 'abandoned' }]
  ] as const)('returns the Grok plan decision on its native request (%j)', async (decision, expected) => {
    const { connection, events, closeAndDrain } = create('acp', 'grok-plan', undefined, 'grok-build')
    await connection.start(cwd)
    const sending = connection.send(input)
    const { request } = await waitForApproval(events)
    expect(request).toMatchObject({ toolName: 'ExitPlanMode', input: { plan: '# Release plan' } })
    toolApprovalRegistry.dispatch(request.approvalId, decision)
    await sending
    await closeAndDrain()
    expect((await readWire()).find((message) => message.id === 'callback-1')?.result).toEqual(expected)
  })

  it.each([
    ['grok-question-plan', 'discuss', 'chat_about_this'],
    ['grok-question-plan', 'skip-interview', 'skip_interview'],
    ['grok-question', 'skip-interview', 'cancelled']
  ] as const)(
    'scopes %s %s to the original wire request and archives the delivered decision',
    async (scenario, action, outcome) => {
      const { connection, events, closeAndDrain } = create('acp', scenario, undefined, 'grok-build')
      await connection.start(cwd)
      const sending = connection.send(input)
      const { request } = await waitForApproval(events)
      if (scenario === 'grok-question-plan')
        expect(request.input).toMatchObject({ interviewActions: ['discuss', 'skip-interview'] })
      else expect(request.input).not.toHaveProperty('interviewActions')
      toolApprovalRegistry.dispatch(request.approvalId, {
        approved: true,
        updatedInput: {
          action,
          selections: [
            { selected: ['C', 'A, B'] },
            { selected: [], freeform: true, notes: 'private draft' },
            { selected: [] }
          ],
          answers: { 'Which?': 'stale answer' }
        }
      })
      await sending
      await closeAndDrain()
      const wire = await readWire()
      const partial = { 'Which?': 'A, B, C', 'Why?': 'Other' }
      expect(wire.find((message) => message.id === 'callback-1')?.result).toEqual(
        outcome === 'cancelled' ? { outcome } : { outcome, partial_answers: partial }
      )
      expect(wire.filter((message) => message.method === 'session/prompt')).toHaveLength(1)
      const last = observedParts(events)
        .filter((part) => part.type === 'dynamic-tool' && part.toolCallId === request.toolCallId)
        .at(-1)
      expect(last).toMatchObject({
        state: 'output-available',
        output: outcome === 'cancelled' ? { approved: false } : { interviewAction: action, answers: partial }
      })
    }
  )

  it('can skip the entire Grok plan interview before answering the first question', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'grok-question-plan', undefined, 'grok-build')
    await connection.start(cwd)
    const sending = connection.send(input)
    const { request } = await waitForApproval(events)
    toolApprovalRegistry.dispatch(request.approvalId, {
      approved: true,
      updatedInput: { action: 'skip-interview', selections: [{ selected: [] }, { selected: [] }, { selected: [] }] }
    })
    await sending
    await closeAndDrain()
    expect((await readWire()).find((message) => message.id === 'callback-1')?.result).toEqual({
      outcome: 'skip_interview',
      partial_answers: {}
    })
  })

  it.each(['grok-question-cancel', 'grok-question-invalid'])('retires a Grok question after %s', async (scenario) => {
    const { connection, events, closeAndDrain } = create('acp', scenario, undefined, 'grok-build')
    await connection.start(cwd)
    const sending = connection.send(input)
    const { request } = await waitForApproval(events)
    if (scenario === 'grok-question-invalid') {
      toolApprovalRegistry.dispatch(request.approvalId, {
        approved: true,
        updatedInput: { selections: [{ selected: ['invented'] }, { selected: [] }, { selected: [] }] }
      })
    }
    await sending
    expect(toolApprovalRegistry.hasSession('session')).toBe(false)
    expect(toolApprovalRegistry.dispatch(request.approvalId, { approved: true })).toBeUndefined()
    await closeAndDrain()
    expect((await readWire()).find((message) => message.id === 'callback-1')?.result).toEqual({ outcome: 'cancelled' })
  })

  it.each([
    ['grok-question-foreign', 'grok-build', false, { result: { outcome: 'cancelled' } }],
    ['grok-plan', 'grok-build', true, { result: { outcome: 'abandoned' } }],
    ['grok-question', 'custom', false, { error: { code: -32601 } }]
  ] as const)(
    'only opens native Grok approvals in the owning interactive session (%s, %s)',
    async (scenario, preset, headless, expected) => {
      const { connection, events, closeAndDrain } = create('acp', scenario, undefined, preset, undefined, headless)
      await connection.start(cwd)
      await connection.send(input)
      await closeAndDrain()
      expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(0)
      expect((await readWire()).find((message) => message.id === 'callback-1')).toMatchObject(expected)
    }
  )

  it.each(['xai-usage', 'xai-usage-legacy'])(
    'attributes only matching foreground completions for %s',
    async (scenario) => {
      const { connection, events, closeAndDrain } = create('acp', scenario, undefined, 'grok-build')
      await connection.start(cwd)
      await connection.send(input)
      await connection.send(input)
      await closeAndDrain()
      const invocations = events.flatMap((event) => (event.type === 'local-turn-usage' ? [event.summary] : []))
      expect(invocations).toHaveLength(1)
      expect(invocations[0].usage).toEqual({
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        noCacheTokens: 50,
        reasoningTokens: 5,
        cacheReadTokens: 40,
        cacheWriteTokens: 10
      })
      expect(events.filter((event) => event.type === 'usage')).toEqual([])
      const requests = (await readWire()).filter(({ method }) => method === 'session/prompt')
      const ids = requests.map(({ params }) => params._meta.promptId)
      expect(ids).toHaveLength(2)
      expect(ids[0]).not.toBe(ids[1])
    }
  )

  it('prefers the Grok prompt result over fallback notifications and keeps reported zero usage', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'xai-usage-response', undefined, 'grok-build')
    await connection.start(cwd)
    await connection.send(input)
    await connection.send(input)
    await closeAndDrain()
    expect(events.flatMap((event) => (event.type === 'local-turn-usage' ? [event.summary.usage] : []))).toEqual([
      { inputTokens: 7, outputTokens: 2, totalTokens: 9, noCacheTokens: 7 },
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, noCacheTokens: 0 }
    ])
  })

  it('leaves usage unknown when Grok returns a different native prompt ID', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'xai-usage-reassigned', undefined, 'grok-build')
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(events.some((event) => event.type === 'local-turn-usage')).toBe(false)
  })

  it.each(['copilot', 'custom', undefined])('uses ordinary ACP usage for preset %s', async (presetId) => {
    const { connection, events, closeAndDrain } = create('acp', 'xai-usage-response', undefined, presetId)
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(events.some((event) => event.type === 'local-turn-usage')).toBe(false)
    const request = (await readWire()).find(({ method }) => method === 'session/prompt')
    expect(request.params._meta?.promptId).toBeUndefined()
  })

  it('keeps Codex usage scoped to the turn without counting history or duplicate notifications', async () => {
    const { connection, events, closeAndDrain } = create('codex', 'codex-usage')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))
    await connection.send(input)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(2))
    await closeAndDrain()
    const summaries = events.flatMap((event) => (event.type === 'local-turn-usage' ? [event.summary] : []))
    expect(summaries.at(-1)?.usage).toEqual({
      inputTokens: 40,
      outputTokens: 4,
      totalTokens: 44,
      cacheReadTokens: 20,
      noCacheTokens: 20,
      reasoningTokens: 2
    })
    expect(summaries.find((summary) => summary.usage.totalTokens === 330)?.usage).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
      cacheReadTokens: 150,
      noCacheTokens: 150,
      reasoningTokens: 15
    })
    expect(
      summaries.every((summary) => summary.nativeSessionId === 'native-session' && summary.correlation === 'unknown')
    ).toBe(true)
    expect(events.filter((event) => event.type === 'usage')).toEqual([])
  })

  it.each(['normal', 'codex-usage-invalid'])('does not invent Codex usage for %s notifications', async (scenario) => {
    const { connection, events, closeAndDrain, text } = create('codex', scenario)
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'turn-complete')).toBe(true))
    await closeAndDrain()
    expect(text()).toContain('hello')
    expect(events.filter((event) => event.type === 'local-turn-usage')).toEqual([])
  })

  it('marks context usage as unsupported without inventing numbers when the agent omits it', async () => {
    const { connection, events, closeAndDrain } = create('acp')
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(
      events.filter(
        (event) =>
          event.type === 'usage' ||
          event.type === 'local-turn-usage' ||
          (event.type === 'context-usage' && event.result.status !== 'unsupported')
      )
    ).toEqual([])
    expect(events).toContainEqual({
      type: 'context-usage',
      result: expect.objectContaining({ status: 'unsupported' })
    })
  })

  // Enumeration must not infer, apply a stale saved model, or create a Codex thread.
  it.each(['acp', 'codex'] as const)('%s loads real model IDs without sending a prompt', async (protocol) => {
    const catalog = await listLocalAgentModels({
      presetId: protocol === 'codex' ? 'codex' : undefined,
      enabled: false,
      nativeModel: 'stale-model',
      executableOverride: process.execPath,
      args: [fixture, protocol, 'normal'],
      env: { FIXTURE_LOG: path.join(cwd, 'models.jsonl') }
    })
    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0]).toMatchObject({ id: 'fixture-model', name: 'Fixture model' })
    if (protocol === 'codex') expect(catalog.models[0].effort?.options.map(({ value }) => value)).toContain('ultra')
    const wire = await readWire('models.jsonl')
    expect(
      wire.some((message) =>
        ['session/prompt', 'turn/start', 'thread/start', 'session/set_config_option'].includes(message.method)
      )
    ).toBe(false)
  })

  it('reads setup model updates for the queried ACP session without granting host access', async () => {
    const catalog = await listLocalAgentModels(fixtureConfig('acp', 'close-management-catalog'))
    expect(LocalAgentModelCatalogSchema.parse(catalog)).toMatchObject({
      models: [
        {
          id: 'updated-model',
          name: 'Updated model',
          description: 'Updated model description',
          _meta: { fixture: { modalities: ['text', 'image'] } },
          effort: { options: [{ value: 'balanced' }, { value: 'deep' }] }
        },
        { id: 'alternate-model', name: 'Alternate model' }
      ],
      activeModel: { id: 'updated-model' }
    })
    expect(catalog.models[1]).not.toHaveProperty('effort')
    const wire = await readWire()
    expect(wire.map(({ method }) => method)).toEqual(['initialize', 'session/new', 'session/close'])
    const capabilities = wire[0].params.clientCapabilities
    expect(capabilities.fs).toEqual({ readTextFile: false, writeTextFile: false })
    expect(capabilities.terminal).toBe(false)
    expect(capabilities).not.toHaveProperty('elicitation')
    expect(wire[1].params.mcpServers).toEqual([])
  })

  it('lists Grok effort per model without opening a session', async () => {
    const catalog = await listLocalAgentModels({
      ...fixtureConfig('acp', 'grok-model-catalog'),
      presetId: 'grok-build'
    })
    expect(catalog.models).toEqual([
      {
        id: 'grok-reasoning',
        name: 'Grok Reasoning',
        description: 'Grok model description',
        _meta: { reasoningEfforts: [{ value: 'high', label: 'High', default: true }], fixture: { fast: true } },
        effort: { defaultValue: 'high', options: [{ value: 'high', name: 'High' }] }
      },
      { id: 'grok-basic', name: 'Grok Basic' }
    ])
    expect((await readWire()).map(({ method }) => method)).toEqual(['initialize', '_x.ai/models/list'])
  })

  it('matches subscription model aliases for display while preserving the native model identity', async () => {
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? path.resolve('packages/provider-registry/data', filename)
        : path.join(cwd, filename ?? '')
    )
    providerRegistryService.clearCache()
    const id = 'kimi-code/kimi-for-coding'
    const hint = { fixture: { tier: 'subscription' } }
    const models = [
      { id, name: 'K2.8 Preview', _meta: hint },
      { id: 'kimi-code/k3-256k', name: 'K3-256k' },
      { id, name: 'Different release' }
    ]
    try {
      const [preview, restricted, unknown] = enrichLocalAgentModels(models, 'kimi')
      expect(preview).toMatchObject({
        id,
        name: 'K2.8 Preview',
        _meta: hint,
        registryModel: {
          id: 'kimi-k2-8-preview',
          capabilities: expect.arrayContaining(['reasoning', 'function-call'])
        }
      })
      expect(restricted).toMatchObject({ id: 'kimi-code/k3-256k', registryModel: { id: 'kimi-k3' } })
      expect(unknown).toEqual(models[2])
      const [oss, orchestrator] = enrichLocalAgentModels(
        [
          { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
          { id: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' }
        ],
        'antigravity-acp'
      )
      expect(oss).toMatchObject({
        id: 'gpt-oss-120b-medium',
        registryModel: { id: 'gpt-oss-120b', capabilities: expect.arrayContaining(['reasoning', 'function-call']) }
      })
      expect(orchestrator.registryModel).toBeUndefined()

      const cursor = await listLocalAgentModels({ presetId: 'cursor', enabled: true, args: [], env: {} })
      expect(cursor.models[0]).toMatchObject({
        id: 'opus-5.5',
        description: 'Native description',
        registryModel: {
          id: 'claude-opus-5-5',
          capabilities: expect.arrayContaining(['reasoning', 'function-call'])
        }
      })
      expect(cursor.models[1].registryModel).toBeUndefined()
    } finally {
      providerRegistryService.clearCache()
    }
  })

  it('loads Antigravity models from the official agy ACP command', async () => {
    const windows = process.platform === 'win32'
    const command = path.join(cwd, windows ? 'agy.cmd' : 'agy')
    const invoke = `"${process.execPath}" "${fixture}" acp normal`
    await writeFile(
      command,
      windows
        ? `@echo off\r\nif not "%~1"=="acp" exit /b 2\r\n${invoke}\r\n`
        : `#!/bin/sh\n[ "$1" = acp ] || exit 2\nexec ${invoke}\n`,
      { mode: 0o755 }
    )
    MockApplicationUtils.setService('BinaryManager', {
      getToolSnapshots: async () => ({ agy: { name: 'agy', availability: { source: 'system', path: command } } })
    })
    const catalog = await listLocalAgentModels({
      presetId: 'antigravity-acp',
      enabled: true,
      args: [],
      env: {}
    })
    expect(catalog.models).toEqual([{ id: 'fixture-model', name: 'Fixture model' }])
  })

  it.each(['acp', 'codex'] as const)('%s applies the selected native model on connection', async (protocol) => {
    const { connection } = create(protocol, 'normal', 'fixture-model')
    await connection.start(cwd)
    expect(connection.localSessionInfo.activeModel?.id).toBe('fixture-model')
    const wire = await readWire()
    const request = wire.find(
      (message) => message.method === (protocol === 'acp' ? 'session/set_config_option' : 'thread/start')
    )
    expect(request.params).toMatchObject(
      protocol === 'acp' ? { configId: 'model', value: 'fixture-model' } : { model: 'fixture-model' }
    )
  })

  it('sends the advertised ACP model ID for a provider-configured model', async () => {
    const { connection, text, closeAndDrain } = create(
      'acp',
      'provider-qwen',
      'deepseek/deepseek-flash',
      'qwen',
      'cherryin::deepseek/deepseek-flash'
    )
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(text()).toContain('hello')
    const selection = (await readWire()).find((message) => message.method === 'session/set_config_option')
    expect(selection.params.value).toBe('deepseek/deepseek-flash(openai)')
  })

  it.each(['acp', 'codex'] as const)('%s handshake never sends a prompt', async (protocol) => {
    expect((await checkLocalAgent(fixtureConfig(protocol, 'normal'))).ok).toBe(true)
    const wire = await readWire()
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

  it('defers ACP resume-token until a turn runs on a new session, but publishes immediately on restore', async () => {
    const fresh = create('acp')
    await fresh.connection.start(cwd)
    expect(fresh.events.some((event) => event.type === 'local-session-info')).toBe(true)
    expect(fresh.events.filter((event) => event.type === 'resume-token')).toEqual([])

    await fresh.connection.send(input)
    await vi.waitFor(() => expect(fresh.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))
    expect(fresh.events.filter((event) => event.type === 'resume-token')).toEqual([
      { type: 'resume-token', token: 'native-session' }
    ])
    await fresh.closeAndDrain()

    const restored = create('acp')
    await restored.connection.start(cwd, 'native-session')
    expect(restored.events.filter((event) => event.type === 'resume-token')).toEqual([
      { type: 'resume-token', token: 'native-session' }
    ])
    await restored.closeAndDrain()
  })

  it.each(['approved-write', 'approved-write-changed', 'approved-write-repeated'])(
    'reuses only a single identical approved write (%s)',
    async (scenario) => {
      const { connection, events } = create('acp', scenario)
      await connection.start(cwd)
      const sending = connection.send(input)
      const first = await waitForApproval(events)
      expect(first.request.toolName).toBe('ACP: Write file')
      toolApprovalRegistry.dispatch(first.request.approvalId, { approved: true })
      if (scenario !== 'approved-write') {
        await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2))
        const next = events.filter((event) => event.type === 'tool-approval-request')[1]
        if (next.type !== 'tool-approval-request') throw new Error('Missing approval')
        toolApprovalRegistry.dispatch(next.request.approvalId, { approved: false })
      }
      await sending
      if (scenario === 'approved-write-changed')
        await expect(readFile(path.join(cwd, 'approved.txt'))).rejects.toThrow()
      else expect(await readFile(path.join(cwd, 'approved.txt'), 'utf8')).toBe('approved content')
      expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(
        scenario === 'approved-write' ? 1 : 2
      )
    }
  )

  it('does not carry an unused write approval into the next turn', async () => {
    const { connection, events } = create('acp', 'approved-write-later-turn')
    await connection.start(cwd)
    for (const approved of [true, false]) {
      events.length = 0
      const sending = connection.send(input)
      const approval = await waitForApproval(events)
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved })
      await sending
    }
    await expect(readFile(path.join(cwd, 'approved.txt'))).rejects.toThrow()
  })

  it('ends incomplete tool presentation without inventing a successful result', async () => {
    const { connection, events } = create('acp', 'missing-tool-result')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'turn-complete')).toBe(true))
    const inputs = observedParts(events).flatMap((chunk) =>
      chunk.type === 'dynamic-tool' && chunk.state === 'input-available' ? [chunk.input] : []
    )
    expect(inputs.at(-1)).toMatchObject({ localAcpTool: { status: 'in_progress', turnEnded: true } })
    expect(
      observedParts(events).some((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-available')
    ).toBe(false)
  })

  it.each(['accept', 'decline', 'cancel', 'invalid', 'close'])(
    'returns a validated ACP form response or a distinct negative outcome (%s)',
    async (action) => {
      const { connection, events, text } = create('acp', 'elicitation')
      await connection.start(cwd)
      const sending = connection.send(input)
      const approval = await waitForApproval(events)
      expect(approval.request.toolName).toBe('AskUserQuestion')
      if (action === 'close') await connection.close()
      else
        toolApprovalRegistry.dispatch(approval.request.approvalId, {
          approved: action === 'accept' || action === 'invalid',
          updatedInput: {
            elicitationAction: action,
            elicitationContent: { count: action === 'invalid' ? 6 : 2, enabled: false }
          }
        })
      await sending
      if (action === 'close') {
        expect(toolApprovalRegistry.hasSession('session')).toBe(false)
        expect(await readFile(path.join(cwd, 'wire.jsonl'), 'utf8')).toContain('"action":"cancel"')
      } else {
        const result = JSON.parse(text().replace('turn 1: ', ''))
        expect(result).toEqual(
          action === 'accept'
            ? { action: 'accept', content: { count: 2, enabled: false } }
            : { action: action === 'invalid' ? 'cancel' : action }
        )
      }
    }
  )

  it.each(['elicitation-foreign', 'elicitation-url'])(
    'does not present unsupported or foreign requests (%s)',
    async (scenario) => {
      const { connection, events, text } = create('acp', scenario)
      await connection.start(cwd)
      await connection.send(input)
      await vi.waitFor(() => expect(events.some((event) => event.type === 'turn-complete')).toBe(true))
      expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
      expect(text()).toContain(scenario === 'elicitation-url' ? '-32602' : '"action":"cancel"')
    }
  )

  it('preserves ACP permission option identity and scope', async () => {
    const { connection, events, text } = create('acp', 'permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    expect(approval.request.input.localPermissionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionId: 'always', decision: 'acceptForSession', label: 'allow_session' })
      ])
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'always' }
    })
    await sending
    expect(text()).toContain('"optionId":"always"')
    await vi.waitFor(() =>
      expect(
        observedParts(events).filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-available')
      ).toHaveLength(1)
    )
  })

  it('settles a standalone ACP approval card even when the agent uses a separate execution tool ID', async () => {
    const { connection, events } = create('acp', 'standalone-permission')
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: false,
      updatedInput: { localPermissionOption: 'deny' }
    })
    await sending
    expect(observedParts(events)).toContainEqual(
      expect.objectContaining({
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 'tool',
        output: { outcome: 'selected', optionId: 'deny' }
      })
    )
  })

  it.each(['command', 'file'])('keeps Codex %s approval details scoped to the current turn', async (kind) => {
    const { connection, events } = create('codex', `codex-approval-context-${kind}`)
    await connection.start(cwd)
    for (let turn = 0; turn < 2; turn++) {
      await connection.send(input)
      const approval = await waitForApproval(events)
      expect(approval.request.input).toMatchObject({
        threadId: 'native-session',
        turnId: 'turn',
        itemId: 'tool',
        reason: 'Review action'
      })
      if (turn === 0)
        expect(approval.request.input).toMatchObject(
          kind === 'command'
            ? { command: 'echo fixture', cwd }
            : { changes: [{ path: path.join(cwd, 'example.txt'), kind: { type: 'add' }, diff: 'review this content' }] }
        )
      else {
        expect(approval.request.input).not.toHaveProperty('command')
        expect(approval.request.input).not.toHaveProperty('changes')
      }
      toolApprovalRegistry.dispatch(approval.request.approvalId, {
        approved: true,
        updatedInput: { localPermissionOption: 'accept' }
      })
      await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))
      events.length = 0
    }
    expect((await readWire()).filter((message) => message.id === 'approval')).toEqual([
      { id: 'approval', result: { decision: 'accept' } },
      { id: 'approval', result: { decision: 'accept' } }
    ])
  })

  it('preserves a native Codex interrupted turn as cancellation', async () => {
    const { connection, events } = create('codex', 'interrupted')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'turn-complete', status: 'paused' }))
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([
      { type: 'turn-complete', status: 'paused' }
    ])
  })

  it.each(['allow', 'deny'])('returns the original Codex network %s decision with readable labels', async (action) => {
    const { connection, events } = create('codex', `codex-network-${action}`)
    await connection.start(cwd)
    await connection.send(input)
    const approval = await waitForApproval(events)
    const decision = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.com', action } } }
    const optionId = JSON.stringify(decision)
    expect(approval.request.input.localPermissionOptions).toContainEqual(
      expect.objectContaining({
        optionId,
        name: `${action === 'allow' ? 'Always allow' : 'Always deny'} host: example.com`,
        decision: action === 'allow' ? 'acceptAlways' : 'decline',
        label: action === 'allow' ? 'allow_always_host' : 'deny_always_host',
        labelTarget: 'example.com'
      })
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: action === 'allow',
      updatedInput: { localPermissionOption: optionId }
    })
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn-complete' })))
    expect(await readWire()).toContainEqual({ id: 'approval', result: { decision } })
  })

  it('formats Codex execpolicy amendment decisions cleanly while preserving the original decision', async () => {
    const { connection, events } = create('codex', 'codex-execpolicy')
    await connection.start(cwd)
    await connection.send(input)
    const approval = await waitForApproval(events)
    const decision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } }
    const optionId = JSON.stringify(decision)
    expect(approval.request.input.localPermissionOptions).toContainEqual(
      expect.objectContaining({
        optionId,
        name: 'Always allow: git status',
        decision: 'acceptAlways',
        label: 'allow_always_target',
        labelTarget: 'git status'
      })
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: optionId }
    })
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn-complete' })))
    expect(await readWire()).toContainEqual({ id: 'approval', result: { decision } })
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

  it('reports a process startup failure instead of a generic closed connection', async () => {
    const { connection } = create('acp')
    await expect(connection.start(path.join(cwd, 'missing'))).rejects.toThrow(/ENOENT/)
  })

  it('retains redacted stderr when an ACP process exits during initialization', async () => {
    const { connection } = create('acp', 'startup-error')
    const started = connection.start(cwd)
    await expect(started).rejects.toThrow('Missing native backend')
    await expect(started).rejects.not.toThrow('fixture-secret')
  })

  it('rejects a saved model that disappeared from the catalog before sending a change request', async () => {
    const { connection } = create('acp', 'both-models', 'retired-model')
    await expect(connection.start(cwd)).rejects.toThrow(/retired-model/)
    expect(
      (await readWire()).some(
        (message) => message.method === 'session/set_model' || message.method === 'session/set_config_option'
      )
    ).toBe(false)
  })

  it('preserves and redacts nested ACP failure details instead of reporting only Internal error', async () => {
    const { connection, events } = create('acp', 'error-details')
    await connection.start(cwd)
    await connection.send(input)
    const failure = events.find((event) => event.type === 'error')
    expect(failure?.type === 'error' && String(failure.error)).toContain('No model selected')
    expect(failure?.type === 'error' && String(failure.error)).not.toContain('private-fixture-secret')
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(0)
  })

  it.each([
    ['terminal-command', 'command result', 0],
    ['terminal-path', 'prefix你好🌸', 0],
    ['terminal-literal', 'literal ; echo injected', 0],
    ['terminal-missing', 'missing-fixture-executable', 1]
  ])('executes %s with the approved command semantics and useful diagnostics', async (scenario, expected, exitCode) => {
    const { connection, events, text } = create('acp', scenario)
    if (scenario === 'terminal-path')
      await symlink(process.execPath, path.join(cwd, `node with spaces${path.extname(process.execPath)}`))
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await sending
    expect(JSON.parse(text())).toMatchObject({ output: expect.stringContaining(expected), exitStatus: { exitCode } })
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
      else {
        expect(text()).not.toContain('terminal-result')
        expect(approval.request.input.env).toEqual([{ name: 'APPROVAL_ENV', value: 'terminal-result' }])
      }
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    }
    await sending
    expect(await readFile(path.join(cwd, 'callback.txt'), 'utf8')).toBe('line1\nline2\nline3')
    expect(text()).toBe('turn 1: line2terminal-result')
    await vi.waitFor(() =>
      expect(
        observedParts(events).filter((chunk) => chunk.type === 'dynamic-tool' && chunk.state === 'output-available')
      ).toHaveLength(3)
    )
    const terminalInputs = observedParts(events).flatMap((chunk) =>
      chunk.type === 'dynamic-tool' && chunk.state === 'output-available' && chunk.toolCallId === 'terminal-tool'
        ? [chunk.input]
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

  it.each([
    ['terminal-split', '你好🌸界', false, 1024],
    ['terminal-limit:6', '🌸!', true, 6],
    ['terminal-limit:2', '!', true, 2],
    ['terminal-limit:0', '', true, 0]
  ])('retains complete UTF-8 characters in terminal output (%s)', async (scenario, expected, truncated, limit) => {
    const { connection, events, text } = create('acp', scenario)
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await sending
    expect(JSON.parse(text())).toEqual({ output: expected, truncated, exitStatus: { exitCode: 0 } })
    expect(Buffer.byteLength(JSON.parse(text()).output)).toBeLessThanOrEqual(limit)
  })

  it.skipIf(process.platform === 'win32')('reports signal termination in terminal output', async () => {
    const { connection, events, text } = create('acp', 'terminal-signal')
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await sending
    expect(JSON.parse(text())).toEqual({ output: '', truncated: false, exitStatus: { signal: 'SIGTERM' } })
  })

  it('keeps a completed terminal queryable until release after its prompt ends', async () => {
    const { connection, events } = create('acp', 'terminal-idle')
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await sending
    await vi.waitFor(async () => {
      const wire = await readWire()
      expect(wire.some((response) => response.result?.output === 'prefix你好🌸')).toBe(true)
      expect(wire.some((response) => response.error?.data?.details === 'Unknown session terminal')).toBe(true)
    })
  })

  it('rejects foreign-session file and terminal callbacks before accessing resources or requesting approval', async () => {
    await writeFile(path.join(cwd, 'marker.txt'), 'private marker')
    const { connection, events, text } = create('acp', 'callback-boundaries')
    await connection.start(cwd)
    let finished = false
    const sending = connection.send(input).finally(() => {
      finished = true
    })
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await vi.waitFor(() =>
      expect(finished || events.filter((event) => event.type === 'tool-approval-request').length > 1).toBe(true)
    )
    for (const event of events.filter((event) => event.type === 'tool-approval-request').slice(1))
      toolApprovalRegistry.dispatch(event.request.approvalId, { approved: false })
    await sending
    expect(JSON.parse(text())).toEqual(Array.from({ length: 7 }, () => expect.objectContaining({ code: -32602 })))
    expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(1)
    await expect(readFile(path.join(cwd, 'foreign.txt'))).rejects.toThrow()
  })

  it.each([
    ['resume-only', undefined, 'session/resume'],
    ['resume-both', undefined, 'session/resume'],
    ['resume-null', undefined, 'session/load'],
    ['resume-both', 'openclaw', 'session/load']
  ])('restores ACP state using negotiated capabilities: %s, preset=%s', async (scenario, presetId, method) => {
    const { connection, events, text } = create('acp', scenario, undefined, presetId)
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
    const requests = await readWire()
    const restore = requests.filter(({ method }) => ['session/load', 'session/resume', 'session/new'].includes(method))
    expect(restore).toEqual([
      expect.objectContaining({
        method,
        params: { sessionId: 'native-session', cwd, mcpServers: [] }
      })
    ])
  })

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
      const requests = await readWire()
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
      expect(observedParts(events).some((chunk) => chunk.type === 'append' && chunk.kind === 'text')).toBe(true)
    )
    await connection.close()
    await sending
    await drained
    const requests = await readWire()
    expect(
      requests.filter(({ method }) => ['session/cancel', 'session/close'].includes(method)).map(({ method }) => method)
    ).toEqual(['session/cancel', 'session/close'])
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
  })

  it('preserves grouped custom choices and boolean settings, and rejects removed or invalid options', async () => {
    const { connection } = create('acp', 'config-extra')
    await connection.start(cwd)
    const acp = connection as AcpConnection
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
    const wire = await readWire()
    expect(wire.filter(({ method }) => method === 'session/set_config_option').map(({ params }) => params)).toEqual([
      { sessionId: 'native-session', configId: 'verbosity', value: 'verbose' },
      { sessionId: 'native-session', configId: 'notifications', type: 'boolean', value: true }
    ])
  })

  it('switches Copilot native approval separately from workflow and keeps the linked Plan command', async () => {
    const fixture = create('acp', 'copilot-native-permissions', undefined, 'copilot')
    const connection = fixture.connection as AcpConnection
    await connection.start(cwd)

    await connection.setMode(ACP_HOST_PERMISSION_MODE_ID, 'bypassPermissions')
    expect(connection.localSessionInfo.hostPermission).toBeUndefined()
    expect(connection.localSessionInfo.mode).toMatchObject({ id: 'allow_all', currentValue: 'off' })
    await connection.setMode('allow_all', 'on')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('on')
    expect(connection.localSessionInfo.configOptions?.find(({ id }) => id === 'mode')?.currentValue).toBe(
      'https://agentclientprotocol.com/protocol/session-modes#agent'
    )
    await connection.setMode('allow_all', ACP_NATIVE_PLAN_VALUE)
    expect(connection.localSessionInfo.mode?.currentValue).toBe(ACP_NATIVE_PLAN_VALUE)
    expect(connection.localSessionInfo.configOptions?.find(({ id }) => id === 'mode')?.currentValue).toBe(
      'https://agentclientprotocol.com/protocol/session-modes#plan'
    )
    await connection.setMode('allow_all', 'off')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('off')
    expect(connection.localSessionInfo.configOptions?.find(({ id }) => id === 'mode')?.currentValue).toBe(
      'https://agentclientprotocol.com/protocol/session-modes#agent'
    )
  })

  it('keeps MiniMax legacy Plan while refusing the persistent approval setter', async () => {
    const fixture = create('acp', 'minimax-native-permissions', undefined, 'minimax')
    const connection = fixture.connection as AcpConnection
    await connection.start(cwd)
    expect(connection.localSessionInfo.hostPermission?.id).toBe(ACP_HOST_PERMISSION_MODE_ID)
    expect(connection.localSessionInfo.configOptions?.some(({ id }) => id === 'permissionMode')).toBe(false)
    await expect(connection.setMode('permissionMode', 'bypassPermissions')).rejects.toThrow('no longer available')
    await expect(connection.setConfigOption('permissionMode', 'bypassPermissions')).rejects.toThrow(
      'no longer available'
    )
    await connection.setMode('legacy-mode', 'plan')
    expect(connection.localSessionInfo.hostPermission?.currentValue).toBe('plan')
    await connection.setMode('legacy-mode', 'default')
    expect(connection.localSessionInfo.hostPermission?.currentValue).toBe('default')
  })

  it.each([
    ['antigravity-acp', 'antigravity-native-permissions', 'accept-edits', 'acceptEdits'],
    ['kimi', 'kimi-native-permissions', 'auto', 'auto'],
    ['qwen', 'qwen-native-permissions', 'auto-edit', 'acceptEdits'],
    ['devin', 'devin-native-permissions', 'smart', 'auto'],
    ['muse-code', 'muse-native-permissions', 'denyUnmatched', 'default']
  ])('applies %s approval through its native session control', async (preset, scenario, value, expected) => {
    const fixture = create('acp', scenario, undefined, preset)
    const connection = fixture.connection as AcpConnection
    await connection.start(cwd)
    expect(connection.localSessionInfo.hostPermission).toBeUndefined()
    await connection.setMode('mode', value)
    expect(connection.localSessionInfo.mode?.currentValue).toBe(value)
    expect(connection.effectivePermissionMode).toBe(expected)
  })

  it('keeps Kilo workflows separate from approvals and can still enter native Plan', async () => {
    const fixture = create('acp', 'kilo-native-permissions', undefined, 'kilo')
    const connection = fixture.connection as AcpConnection
    await connection.start(cwd)
    const host = connection.localSessionInfo.hostPermission
    expect(host?.id).toBe(ACP_HOST_PERMISSION_MODE_ID)
    expect(host?.options.map(({ value }) => value)).toEqual(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
    await connection.setConfigOption('mode', 'ask')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('ask')
    await connection.setMode('mode', 'plan')
    expect(connection.localSessionInfo.hostPermission?.currentValue).toBe('plan')
  })

  it('changes Amp execution environment independently from approvals even when both are ACP modes', async () => {
    const { connection } = create('acp', 'amp-native-permissions', undefined, 'amp-acp')
    await connection.start(cwd)
    await (connection as AcpConnection).setConfigOption('execution-environment', 'orb')
    expect(connection.localSessionInfo.mode).toMatchObject({ id: 'permission', currentValue: 'default' })
    expect(connection.localSessionInfo.configOptions).toEqual([
      expect.objectContaining({ id: 'execution-environment', currentValue: 'orb' })
    ])
  })

  it('changes Kiro Autopilot separately from work modes and excludes account options', async () => {
    const { connection } = create('acp', 'kiro-native-permissions', undefined, 'kiro')
    await connection.start(cwd)
    const acp = connection as AcpConnection
    expect(acp.localSessionInfo.mode?.options).toContainEqual(
      expect.objectContaining({ name: 'Autopilot', permissionMode: 'auto' })
    )
    expect(acp.localSessionInfo.hostPermission).toBeUndefined()
    await acp.setMode('autopilot', 'off')
    expect(acp.localSessionInfo.configOptions?.map(({ id }) => id)).toEqual(['mode', 'memoryReflection'])
    await acp.setConfigOption('memoryReflection', 'on')
    expect(acp.localSessionInfo.configOptions?.find(({ id }) => id === 'memoryReflection')?.currentValue).toBe('on')
    expect(acp.localSessionInfo.mode).toMatchObject({ id: 'autopilot', currentValue: 'off' })
    await acp.setMode('autopilot', ACP_NATIVE_PLAN_VALUE)
    expect(acp.localSessionInfo.mode?.currentValue).toBe(ACP_NATIVE_PLAN_VALUE)
  })

  it('switches the native Cline boolean without making Plan an approval setting', async () => {
    const fixture = create('acp', 'cline-native-permissions', undefined, 'cline')
    const connection = fixture.connection as AcpConnection
    await connection.start(cwd)
    expect(connection.localSessionInfo.hostPermission).toBeUndefined()
    await connection.setMode('auto_approve', 'true')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('true')
    await connection.setMode('auto_approve', ACP_NATIVE_PLAN_VALUE)
    expect(connection.localSessionInfo.configOptions?.find(({ id }) => id === 'mode')?.currentValue).toBe('plan')
    await connection.setMode('auto_approve', 'false')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('false')
  })

  it('links Junie native approval to its workflow even when the workflow has no category', async () => {
    const { connection } = create('acp', 'junie-native-permissions', undefined, 'junie')
    await connection.start(cwd)
    expect(connection.localSessionInfo.mode).toMatchObject({ id: 'brave_mode', currentValue: 'brave-auto' })
    await connection.setMode('brave_mode', 'on')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('on')
    await connection.setMode('brave_mode', ACP_NATIVE_PLAN_VALUE)
    expect(connection.localSessionInfo.mode?.currentValue).toBe(ACP_NATIVE_PLAN_VALUE)
    await connection.setMode('brave_mode', 'off')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('off')
    expect(connection.localSessionInfo.configOptions?.find(({ id }) => id === 'mode')?.currentValue).toBe('default')
  })

  it('keeps additional model, mode and reasoning selectors editable without changing primary selections', async () => {
    const { connection } = create('acp', 'config-multiple')
    await connection.start(cwd)
    const acp = connection as AcpConnection
    expect(acp.localSessionInfo.configOptions?.map((option) => option.id)).toEqual([
      'model',
      'secondary-mode',
      'secondary-thought',
      'secondary-model',
      'verbosity',
      'notifications'
    ])
    await acp.setConfigOption('secondary-mode', 'plan')
    await acp.setConfigOption('secondary-thought', 'deep')
    await acp.setConfigOption('secondary-model', 'other-model')
    expect(acp.localSessionInfo.configOptions?.slice(1, 4).map((option) => option.currentValue)).toEqual([
      'plan',
      'deep',
      'other-model'
    ])
    expect(acp.localSessionInfo).toMatchObject({
      mode: { id: 'agent-mode', currentValue: 'ask' },
      thoughtLevel: { id: 'reasoning-budget', currentValue: 'balanced' },
      activeModel: { id: 'fixture-model' }
    })
  })

  it('preserves config categories and priority, ignores unknown types, and replaces dependent options completely', async () => {
    const { connection } = create('acp', 'config-semantics')
    await connection.start(cwd)
    expect(connection.localSessionInfo.configOptions).toMatchObject([
      { id: 'verbosity', category: '_verbosity' },
      { id: 'context-size', category: 'model_config' },
      { id: 'agent-mode', category: 'mode' },
      { id: 'notifications', category: undefined }
    ])
    expect((await readWire()).find(({ method }) => method === 'initialize').params.clientInfo.version).toBe(
      app.getVersion()
    )
    await (connection as AcpConnection).setConfigOption('context-size', 'large')
    expect(connection.localSessionInfo.configOptions?.map(({ id }) => id)).toEqual(['notifications', 'agent-mode'])
    expect(connection.localSessionInfo.thoughtLevel).toBeUndefined()
    expect(connection.localSessionInfo.models).toEqual([])
    expect(connection.localSessionInfo.activeModel).toBeUndefined()
    await expect((connection as AcpConnection).setConfigOption('context-size', 'small')).rejects.toThrow(
      'no longer available'
    )
  })

  it.each(['permission', 'form', 'write', 'terminal', 'wait'])(
    'settles a cancelled %s request without lingering approval or unapproved side effects',
    async (kind) => {
      const { connection, events, text } = create('acp', `request-cancel:${kind}`)
      await connection.start(cwd)
      const sending = connection.send(input)
      const approval = await waitForApproval(events)
      if (kind === 'wait') toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
      await sending
      await vi.waitFor(() => expect(events.some((event) => event.type === 'turn-complete')).toBe(true))
      expect(toolApprovalRegistry.hasSession('session')).toBe(false)
      expect(toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })).toBeUndefined()
      const response = JSON.parse(text())
      if (kind === 'permission') expect(response).toEqual({ outcome: { outcome: 'cancelled' } })
      else if (kind === 'form') expect(response).toEqual({ action: 'cancel' })
      else expect(response.code).toBe(-32800)
      await expect(readFile(path.join(cwd, 'cancelled.txt'))).rejects.toThrow()
      expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    }
  )

  it.each(['completed', 'failed', 'cancel', 'crash', 'unfinished'])(
    'settles compaction on %s without inventing a successful history anchor',
    async (outcome) => {
      const { connection, events, closeAndDrain } = create('acp', `compaction-${outcome}`)
      await connection.start(cwd)
      const sending = connection.send(input)
      await vi.waitFor(() => expect(events.some((event) => event.type === 'compaction-start')).toBe(true))
      if (outcome === 'cancel') await connection.close()
      await sending
      await closeAndDrain()
      expect(events.filter((event) => event.type.startsWith('compaction-'))).toEqual([
        { type: 'compaction-start' },
        outcome === 'failed' ? { type: 'compaction-error', error: 'Summary failed' } : { type: 'compaction-complete' }
      ])
    }
  )

  it('keeps overlapping compactions busy across duplicate, old and unrelated-session events', async () => {
    const { connection, events, drained, text } = create('acp', 'compaction-overlap')
    await connection.start(cwd, 'native-session')
    expect(events.filter((event) => event.type.startsWith('compaction-'))).toEqual([])
    const sending = connection.send(input)
    await vi.waitFor(() => expect(text()).toBe('Still compacting'))
    expect(events.filter((event) => event.type.startsWith('compaction-'))).toEqual([{ type: 'compaction-start' }])
    await connection.close()
    await sending
    await drained
    expect(events.filter((event) => event.type.startsWith('compaction-'))).toEqual([
      { type: 'compaction-start' },
      { type: 'compaction-complete' }
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

  it('filters OpenClaw technical titles and disables the upstream directory prefix without changing the prompt', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'openclaw-title', undefined, 'openclaw')
    await connection.start(cwd)
    await connection.send(input)
    await closeAndDrain()
    expect(events.filter((event) => event.type === 'session-title')).toEqual([
      { type: 'session-title', title: 'Explain the project' }
    ])
    const prompt = (await readWire()).find((message) => message.method === 'session/prompt')
    expect(prompt.params).toMatchObject({ prompt: [{ type: 'text', text: 'hello' }], _meta: { prefixCwd: false } })
  })

  it('keeps bridge-like titles reported by a custom ACP agent', async () => {
    const { connection, events, closeAndDrain } = create('acp', 'openclaw-title')
    await connection.start(cwd)
    await closeAndDrain()
    expect(events.filter((event) => event.type === 'session-title').map((event) => event.title)).toEqual([
      'agent:main:acp-bridge:native-session',
      'acp-bridge:native-session',
      '[Working directory: ~/project…',
      'Explain the project'
    ])
  })

  it.each([undefined, 'native-session'])(
    'receives native titles during setup and conversation without accepting other sessions: %s',
    async (resume) => {
      const { connection, events, closeAndDrain } = create('acp', 'session-title')
      await connection.start(cwd, resume)
      await connection.send(input)
      await closeAndDrain()
      expect(events.filter((event) => event.type === 'session-title')).toEqual([
        { type: 'session-title', title: 'Native initial title' },
        { type: 'session-title', title: 'Native updated title' }
      ])
    }
  )

  it('suppresses ACP replay during load and reports a typed error for unsupported restore', async () => {
    const { connection, text } = create('acp')
    await connection.start(cwd, 'native-session')
    await connection.send(input)
    expect(text()).toBe('turn 1: hello')
    const unsupported = create('acp', 'no-resume', undefined, 'opencode', undefined, true).connection
    await expect(unsupported.start(cwd, 'native-session')).rejects.toBeInstanceOf(LocalAgentSessionRestoreError)
  })

  it('exposes and executes Codex native slash commands (/compact, /usage, /clear, /review)', async () => {
    const { connection, events, text, closeAndDrain } = create('codex')
    await connection.start(cwd)
    const commands = await connection.getSupportedCommands()
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'clear', aliases: ['new'] }),
        expect.objectContaining({ name: 'repo-skill', builtin: false })
      ])
    )

    await connection.send({
      message: {
        data: {
          parts: [
            { type: 'data-knowledge-scope', data: { baseIds: ['kb-1'] } },
            { type: 'text', text: '/compact' }
          ]
        }
      }
    } as unknown as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'compaction-complete' }))
    expect(events).toContainEqual({ type: 'compaction-start' })
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/usage' }] } }
    } as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(text()).toContain('totalTokens'))

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/clear' }] } }
    } as AgentRuntimeUserInput)

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/review check security' }] } }
    } as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(text()).toContain('check security'))

    await closeAndDrain()
    const wire = await readWire()
    expect(wire.map((msg) => msg.method)).toEqual(
      expect.arrayContaining(['thread/compact/start', 'account/usage/read', 'review/start'])
    )
  })

  it('keeps adjacent Codex items in separate parts and writes terminal-only text exactly once', async () => {
    const { connection, events, closeAndDrain } = create('codex', 'codex-text-items')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'turn-complete')).toBe(true))
    await closeAndDrain()
    const edits = events.flatMap((event) => (event.type === 'message.parts' ? [...event.changes] : []))
    expect(edits.filter((edit) => edit.type === 'append').map(({ part, text }) => [part, text])).toEqual([
      [0, 'Working.'],
      [1, 'Finished.']
    ])
    expect(edits.filter((edit) => edit.type === 'finish').map((edit) => edit.providerMetadata?.codex)).toEqual([
      { itemId: 'a', kind: 'agentMessage', phase: 'commentary' },
      { itemId: 'b', kind: 'agentMessage', phase: 'final_answer' }
    ])
  })

  it('reports missing persisted Codex history without switching to a fresh thread', async () => {
    const { connection } = create('codex', 'no-rollout')
    await expect(connection.start(cwd, 'lost')).rejects.toBeInstanceOf(LocalAgentSessionRestoreError)
    expect((await readWire()).filter((request) => request.method === 'thread/start')).toEqual([])
  })

  it('recovers when Codex thread has no rollout file yet on resume, rename, compact, or fork', async () => {
    const { connection, events, text, closeAndDrain } = create('codex', 'no-rollout')
    if (!(connection instanceof CodexSessionHost)) throw new Error('Expected Codex fixture')
    await connection.start(cwd, { kind: 'empty-prewarm', threadId: 'stale-prewarm-thread' })
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'resume-token', token: 'native-session' }))

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/rename Fresh Thread' }] } }
    } as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(events).toContainEqual({ type: 'session-title', title: 'Fresh Thread' }))
    await vi.waitFor(() => expect(text()).toContain('Renamed thread to "Fresh Thread"'))

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/compact' }] } }
    } as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(text()).toContain('Nothing to compact yet'))

    await connection.send({
      message: { data: { parts: [{ type: 'text', text: '/fork' }] } }
    } as AgentRuntimeUserInput)
    await vi.waitFor(() => expect(text()).toContain('Send at least one message before forking'))

    await closeAndDrain()
  })

  it('exposes Codex permission modes from thread metadata and applies mode changes to turn/start', async () => {
    const readonly = create('codex', 'codex-readonly')
    await readonly.connection.start(cwd)
    expect(readonly.connection.localSessionInfo.mode?.currentValue).toBe('readOnly')
    await readonly.connection.close()
    await readonly.drained

    const { connection, events, drained } = create('codex', 'codex-full-access')
    await connection.start(cwd)
    expect(connection.localSessionInfo.mode).toEqual({
      id: 'codex-mode',
      application: 'next-turn',
      currentValue: 'fullAccess',
      options: [
        { value: 'readOnly', name: 'Read Only', permissionMode: 'plan' },
        { value: 'workspace', name: 'Workspace', permissionMode: 'acceptEdits' },
        { value: 'fullAccess', name: 'Full Access', permissionMode: 'bypassPermissions' }
      ]
    })

    await expect(connection.setMode?.('codex-mode', 'invalid')).rejects.toThrow('no longer available')
    await expect(connection.setMode?.('other-id', 'readOnly')).rejects.toThrow('no longer available')

    expect(connection.localSessionInfo.thoughtLevel).toMatchObject({
      id: 'codex-effort',
      currentValue: 'default'
    })
    await expect(connection.setThoughtLevel?.('codex-effort', 'invalid')).rejects.toThrow('no longer available')
    await expect(connection.setThoughtLevel?.('other-id', 'high')).rejects.toThrow('no longer available')
    await connection.setThoughtLevel?.('codex-effort', 'high')
    expect(connection.localSessionInfo.thoughtLevel?.currentValue).toBe('high')

    await connection.setMode?.('codex-mode', 'readOnly')
    expect(connection.localSessionInfo.mode?.currentValue).toBe('readOnly')
    expect(events.some((event) => event.type === 'local-session-info')).toBe(true)

    await connection.send(input)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool-approval-request')).toBe(true))
    await expect(connection.setMode?.('codex-mode', 'workspace')).rejects.toThrow('unavailable or busy')
    await expect(connection.setThoughtLevel?.('codex-effort', 'low')).rejects.toThrow('unavailable or busy')
    const approval = events.find((event) => event.type === 'tool-approval-request')
    if (!approval || approval.type !== 'tool-approval-request') throw new Error('Expected approval request')
    toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: true })
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1))

    await connection.setMode?.('codex-mode', 'fullAccess')
    await connection.setThoughtLevel?.('codex-effort', 'default')
    await connection.send(input)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(2))
    await connection.close()
    await drained

    const turnStarts = (await readWire()).filter((message) => message.method === 'turn/start')
    expect(turnStarts[0].params).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      effort: 'high'
    })
    expect(turnStarts[1].params).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' }
    })
    expect(turnStarts[1].params.effort).toBeUndefined()
  })

  it('exposes native DeepSeek Harness modes from ACP config env when ACP omits modes', async () => {
    const config: LocalAgentConfiguration = {
      presetId: 'deepseek-harness',
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, 'acp', 'normal'],
      env: {
        FIXTURE_LOG: path.join(cwd, 'wire.jsonl'),
        DSH_HOME: cwd,
        DSH_PERMISSION_MODE: 'read-only'
      }
    }
    const launch = localLaunch(config)
    const connection = new AcpConnection('dsh-session', 'dsh-agent', launch.config, launch.target)
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const drained = (async () => {
      for await (const event of connection.events) events.push(event)
    })()

    await connection.start(cwd)
    expect(connection.localSessionInfo.mode).toEqual({
      id: 'dsh-mode',
      application: 'reconnect',
      currentValue: 'read-only',
      options: [
        { value: 'read-only', name: 'Read Only', permissionMode: 'plan' },
        { value: 'workspace-write', name: 'Workspace', permissionMode: 'acceptEdits' },
        { value: 'danger-full-access', name: 'Full Access', permissionMode: 'bypassPermissions' }
      ]
    })
    await connection.close()
    await drained
  })

  it('rebuilds deepseek-harness ACP connections when feature.code_cli.configs changes, leaving other ACP presets current', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.code_cli.configs', {
      [CodeCli.DEEPSEEK_HARNESS]: {
        current: 'cherry:api-gateway',
        gatewayModel: 'openai:gpt-4o'
      }
    } as any)

    const dshConfig: LocalAgentConfiguration = {
      presetId: 'deepseek-harness',
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, 'acp', 'normal'],
      env: {
        FIXTURE_LOG: path.join(cwd, 'wire-dsh.jsonl'),
        DSH_HOME: cwd,
        DSH_PERMISSION_MODE: 'workspace-write'
      }
    }
    const otherConfig: LocalAgentConfiguration = {
      presetId: 'qwen',
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, 'acp', 'normal'],
      env: {
        FIXTURE_LOG: path.join(cwd, 'wire-other.jsonl')
      }
    }

    const dshLaunch = localLaunch(dshConfig)
    const otherLaunch = localLaunch(otherConfig)
    const binding = vi.spyOn(agentProviderService, 'getBinding').mockImplementation((id) => {
      if (id === 'dsh-agent') return { ...dshLaunch.config, encryptedEnv: null }
      if (id === 'other-agent') return { ...otherLaunch.config, encryptedEnv: null }
      return undefined
    })

    try {
      const dsh = new AcpConnection('dsh-session', 'dsh-agent', dshLaunch.config, dshLaunch.target)
      const other = new AcpConnection('other-session', 'other-agent', otherLaunch.config, otherLaunch.target)
      connections.push(dsh, other)

      await dsh.start(cwd)
      await other.start(cwd)

      expect(await dsh.reconcile()).toBe('current')
      expect(await other.reconcile()).toBe('current')

      MockMainPreferenceServiceUtils.setPreferenceValue('feature.code_cli.configs', {
        [CodeCli.DEEPSEEK_HARNESS]: {
          current: 'cherry:api-gateway',
          gatewayModel: 'openai:gpt-4.1'
        }
      } as any)

      expect(await dsh.reconcile()).toBe('rebuild')
      expect(await other.reconcile()).toBe('current')
    } finally {
      binding.mockRestore()
      MockMainPreferenceServiceUtils.resetMocks()
    }
  })

  it('applies a launch-bound gateway model when resuming an ACP session without sourceModelId', async () => {
    const patchPath = path.join(cwd, 'gateway.patch.yml')
    await writeFile(patchPath, '[]')
    const dispose = vi.fn(async () => {})
    const prepareAgent = vi.fn(async () => ({
      nativeModel: 'legacy-model',
      gateway: { patchPath, env: { CHERRY_DSH_GATEWAY_API_KEY: 'test-key' }, dispose }
    }))
    MockApplicationUtils.setService('DeepSeekHarnessService', { prepareAgent })

    const launch = localLaunch({
      presetId: 'deepseek-harness',
      enabled: true,
      executableOverride: process.execPath,
      args: [fixture, 'acp', 'legacy-models'],
      env: { FIXTURE_LOG: path.join(cwd, 'wire.jsonl') }
    })
    const resumed = new AcpConnection('dsh-resume-session', 'dsh-agent', launch.config, launch.target)
    connections.push(resumed)

    await resumed.start(cwd, 'native-session')
    const wire = await readWire()
    expect(wire.filter((message) => message.method === 'session/set_model').map((m) => m.params.modelId)).toEqual([
      'legacy-model'
    ])

    await resumed.close()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['openai-compatible', true],
    ['anthropic', false]
  ])(
    'uses the Cline provider %s without replaying another provider’s saved model',
    async (lastUsedProvider, usesCherry) => {
      MockApplicationUtils.setService('CodeCliService', {
        readConfigFiles: async () => [
          {
            target: 'cline-providers',
            content: JSON.stringify({
              lastUsedProvider,
              providers: {
                'openai-compatible': {
                  cherryManaged: true,
                  settings: {
                    provider: 'openai-compatible',
                    apiKey: 'test-key',
                    baseUrl: 'http://127.0.0.1:23334/v1',
                    model: 'cherryin:agent/deepseek-v4-pro'
                  }
                }
              }
            })
          }
        ]
      })
      const { connection, closeAndDrain } = create('acp', 'normal', 'cherryin:agent/deepseek-v4-pro', 'cline')
      await connection.start(cwd)
      const wire = await readWire()
      const selection = wire.find((m) => m.method === 'session/set_config_option')
      if (usesCherry) {
        expect(connection.localSessionInfo.activeModel?.id).toBe('cherryin:agent/deepseek-v4-pro')
        expect(selection?.params.value).toBe('cherryin:agent/deepseek-v4-pro')
      } else {
        expect(connection.localSessionInfo.activeModel?.id).not.toBe('cherryin:agent/deepseek-v4-pro')
        expect(selection).toBeUndefined()
      }
      await closeAndDrain()
    }
  )

  it('accepts config-file-only Snow sessions without ACP model selectors while still rejecting arbitrary overrides', async () => {
    MockApplicationUtils.setService('CodeCliService', {
      readConfigFiles: async () => [
        {
          target: 'snow-config',
          content: JSON.stringify({
            cherryManaged: true,
            snowcfg: { advancedModel: 'cherryin:agent/deepseek-v4-pro' }
          })
        }
      ]
    })
    const matching = create('acp', 'no-models', 'cherryin:agent/deepseek-v4-pro', 'snow')
    await matching.connection.start(cwd)
    expect(matching.connection.localSessionInfo.models).toEqual([])
    expect(matching.connection.localSessionInfo.activeModel).toEqual({ id: 'cherryin:agent/deepseek-v4-pro' })
    await matching.connection.close()
    await matching.drained

    const overridden = create('acp', 'no-models', 'different-model', 'snow')
    await expect(overridden.connection.start(cwd)).rejects.toThrow('This agent does not support model selection')
    await overridden.connection.close()
    await overridden.drained
  })

  it('advertises writeTextFile: false and terminal: false for antigravity-acp while keeping defaults for other ACP agents', async () => {
    const anti = create('acp', 'normal', undefined, 'antigravity-acp')
    await anti.connection.start(cwd)
    await anti.connection.close()
    await anti.drained
    const antiInit = (await readWire()).find((message) => message.method === 'initialize')
    expect(antiInit.params.clientCapabilities.fs).toEqual({ readTextFile: true, writeTextFile: false })
    expect(antiInit.params.clientCapabilities.terminal).toBe(false)

    await writeFile(path.join(cwd, 'wire.jsonl'), '')
    const standard = create('acp', 'normal')
    await standard.connection.start(cwd)
    await standard.connection.close()
    await standard.drained
    const standardInit = (await readWire()).find((message) => message.method === 'initialize')
    expect(standardInit.params.clientCapabilities.fs).toEqual({ readTextFile: true, writeTextFile: true })
    expect(standardInit.params.clientCapabilities.terminal).toBe(true)
  })

  it('keeps Antigravity edits native even if the agent requests unadvertised host tools', async () => {
    const { connection, text, closeAndDrain } = create('acp', 'acp-policy-yolo', undefined, 'antigravity-acp')
    await connection.start(cwd)
    await connection.setMode?.('agent-mode', 'yolo')
    await connection.send(input)
    expect(JSON.parse(text())).toMatchObject({ wrote: false, terminalDenied: true })
    await expect(readFile(path.join(cwd, 'yolo.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await closeAndDrain()
  })

  it('requires separate host approvals for an unverified ACP yolo mode', async () => {
    const { connection, events, text, closeAndDrain } = create('acp', 'acp-policy-yolo')
    await connection.start(cwd)
    await connection.setMode?.('agent-mode', 'yolo')
    expect(connection.localSessionInfo.mode?.options.find(({ value }) => value === 'yolo')).toMatchObject({
      requiresConfirmation: true
    })
    const sending = connection.send(input)
    for (const index of [0, 1, 2]) {
      const approval = await waitForApproval(events, index)
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: false })
    }
    await sending

    expect(JSON.parse(text())).toEqual({
      perm: { outcome: { outcome: 'selected', optionId: 'deny' } },
      wrote: false,
      terminalDenied: true
    })
    await expect(readFile(path.join(cwd, 'yolo.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await closeAndDrain()
  })

  it('applies ACP host Full Access without changing native mode or granting lasting permissions', async () => {
    const { connection, events, text } = create('acp', 'acp-policy-yolo')
    await connection.start(cwd)
    await connection.setMode(ACP_HOST_PERMISSION_MODE_ID, 'bypassPermissions')
    await connection.send(input)
    await vi.waitFor(() =>
      expect(JSON.parse(text())).toEqual({
        perm: { outcome: { outcome: 'selected', optionId: 'once' } },
        wrote: true,
        term: 'term-ok'
      })
    )
    expect(await readFile(path.join(cwd, 'yolo.txt'), 'utf8')).toBe('yolo ok')
    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
    expect((await readWire()).some(({ method }) => method === 'session/set_config_option')).toBe(false)

    await connection.setMode(ACP_HOST_PERMISSION_MODE_ID, 'default')
    const sending = connection.send(input)
    for (const index of [0, 1, 2]) {
      const approval = await waitForApproval(events, index)
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: false })
    }
    await sending
  })

  it('honors native ACP read-only mode when the host is set to Full Access', async () => {
    const { connection, events, text } = create('acp', 'acp-policy-plan')
    await connection.start(cwd)
    await connection.setMode(ACP_HOST_PERMISSION_MODE_ID, 'bypassPermissions')
    await connection.setMode('agent-mode', 'plan')

    const sending = connection.send(input)
    for (const index of [0, 1, 2]) {
      const approval = await waitForApproval(events, index)
      toolApprovalRegistry.dispatch(approval.request.approvalId, { approved: false })
    }
    await sending
    await vi.waitFor(() => expect(JSON.parse(text())).toMatchObject({ wrote: false, terminalDenied: true }))
  })

  it('auto-accepts an ACP edit inside the workspace in the host edit mode', async () => {
    const { connection, events, text } = create('acp', 'acp-policy-auto')
    await connection.start(cwd)
    await connection.setMode(ACP_HOST_PERMISSION_MODE_ID, 'acceptEdits')
    await connection.send(input)
    await vi.waitFor(() => expect(JSON.parse(text())).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } }))
    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
  })

  it('denies unattended ACP approvals, host writes and terminals without prompting', async () => {
    const { connection, events, text } = create('acp', 'acp-policy-yolo', undefined, 'opencode', undefined, true)
    await connection.start(cwd)
    await expect(connection.setMode?.(ACP_HOST_PERMISSION_MODE_ID, 'bypassPermissions')).rejects.toThrow()
    await expect(connection.setMode?.('agent-mode', 'yolo')).rejects.toThrow(
      'Scheduled tasks use the agent configuration'
    )
    await connection.send(input)
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'error',
          error: expect.objectContaining({ message: expect.stringContaining('scheduled task') })
        })
      )
    )
    expect(JSON.parse(text())).toEqual({
      perm: { outcome: { outcome: 'selected', optionId: 'deny' } },
      wrote: false,
      terminalDenied: true
    })
    await expect(readFile(path.join(cwd, 'yolo.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
  })

  it('keeps ACP permission prompts active when native mode is auto', async () => {
    const { connection, events, text, closeAndDrain } = create('acp', 'acp-policy-auto')
    await connection.start(cwd)
    await connection.setMode?.('agent-mode', 'auto')
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'once' }
    })
    await sending
    expect(JSON.parse(text())).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
    await closeAndDrain()
  })

  it('authorizes each delegated terminal separately and honors explicitly granted session permissions', async () => {
    const { connection, events, text, closeAndDrain } = create('acp', 'acp-policy-session-grants')
    await connection.start(cwd)

    const turn1 = connection.send(input)
    const execApproval = await waitForApproval(events)
    toolApprovalRegistry.dispatch(execApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'once' }
    })
    const terminal = await waitForApproval(events, 1)
    expect(terminal.request.toolName).toBe('ACP: Terminal')
    expect(LocalPermissionOptionsSchema.parse(terminal.request.input).localPermissionOptions).toEqual([
      { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
      { optionId: 'allow_session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
      { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
    ])
    toolApprovalRegistry.dispatch(terminal.request.approvalId, { approved: true })
    await turn1
    expect(text()).toBe('turn1-done')

    events.length = 0
    const turn2 = connection.send(input)
    const termApproval = await waitForApproval(events)
    expect(termApproval.request.toolName).toBe('ACP: Terminal')
    toolApprovalRegistry.dispatch(termApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'allow_session' }
    })

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2))
    const editApproval = events.filter((event) => event.type === 'tool-approval-request')[1]
    if (editApproval.type !== 'tool-approval-request') throw new Error('Missing edit approval')
    toolApprovalRegistry.dispatch(editApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'always' }
    })

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(3))
    const outsideWriteApproval = events.filter((event) => event.type === 'tool-approval-request')[2]
    if (outsideWriteApproval.type !== 'tool-approval-request') throw new Error('Missing outside write approval')
    expect(outsideWriteApproval.request.toolName).toBe('ACP: Write')
    expect(LocalPermissionOptionsSchema.parse(outsideWriteApproval.request.input).localPermissionOptions).toEqual([
      { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
      { optionId: 'allow_session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
      { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
    ])
    toolApprovalRegistry.dispatch(outsideWriteApproval.request.approvalId, { approved: false })
    await turn2
    expect(await readFile(path.join(cwd, 'in2.txt'), 'utf8')).toBe('inside-ok')
    expect(JSON.parse(text())).toEqual({ outsideRejected: true })

    // Turn 3: both execute session/request_permission and terminal/create run with zero prompts.
    events.length = 0
    await connection.send(input)
    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
    expect(text()).toBe('turn3-done')

    await closeAndDrain()
  })

  it('auto-approves Codex command, fileChange, and permissions requests under fullAccess without prompting', async () => {
    const { connection, events, text, closeAndDrain } = create('codex', 'codex-full-access-approvals')
    await connection.start(cwd)
    await connection.send(input)
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn-complete' })))

    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
    expect(JSON.parse(text())).toEqual({
      cmd: { decision: 'accept' },
      fc: { decision: 'accept' },
      perms: { permissions: { fileSystem: { read: null, write: [cwd] } }, scope: 'session' }
    })
    await closeAndDrain()
  })

  it.each([undefined, 'native-session'])('keeps unattended Codex read-only with resume token %s', async (resume) => {
    const { connection, events, text } = create(
      'codex',
      'codex-full-access-approvals',
      undefined,
      'codex',
      undefined,
      true
    )
    if (!(connection instanceof CodexSessionHost)) throw new Error('Expected Codex protocol')
    await connection.start(cwd, resume)
    await expect(connection.setMode('codex-mode', 'fullAccess')).rejects.toThrow('no longer available')
    await connection.send(input)

    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'error',
          error: expect.objectContaining({ message: expect.stringContaining('scheduled task') })
        })
      )
    )
    expect(events.some((event) => event.type === 'tool-approval-request')).toBe(false)
    expect(JSON.parse(text())).toEqual({
      cmd: { decision: 'decline' },
      fc: { decision: 'decline' },
      perms: { permissions: {}, scope: 'turn' }
    })
    const wire = await readWire()
    expect(
      wire.find((message) => message.method === (resume ? 'thread/resume' : 'thread/start'))?.params
    ).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { 'mcp_servers.fixture.enabled': false }
    })
    expect(wire.find((message) => message.method === 'turn/start')?.params).toMatchObject({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false }
    })
    expect(await connection.reconcile({ headless: false })).toBe('rebuild')
  })

  it('fails unattended startup if Codex does not confirm the requested sandbox', async () => {
    const { connection } = create('codex', 'codex-ignores-readonly', undefined, 'codex', undefined, true)
    await expect(connection.start(cwd)).rejects.toThrow('could not establish a read-only scheduled task session')
    expect(await readWire()).not.toContainEqual(expect.objectContaining({ method: 'turn/start' }))
  })

  it('asks before granting a different Codex permission after a session grant', async () => {
    const { connection, events, text, closeAndDrain } = create('codex', 'codex-item-permissions')
    await connection.start(cwd)
    await connection.send(input)

    const approval = await waitForApproval(events)
    expect(approval.request.toolName).toBe('Codex: Permissions')
    expect(approval.request.input.localPermissionOptions).toContainEqual(
      expect.objectContaining({ optionId: 'acceptForSession', decision: 'acceptForSession', label: 'allow_session' })
    )
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'acceptForSession' }
    })

    const network = await waitForApproval(events, 1)
    expect(network.request.input.permissions).toEqual({ network: { allowedHosts: ['example.com'] } })
    toolApprovalRegistry.dispatch(network.request.approvalId, { approved: false })
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn-complete' })))
    expect(JSON.parse(text())).toEqual([
      { permissions: { fileSystem: { read: null, write: [cwd] } }, scope: 'session' },
      { permissions: {}, scope: 'turn' }
    ])
    await closeAndDrain()
  })

  it('synthesizes host-managed allow_session when an ACP server only offers allow_once (like agy acp)', async () => {
    const { connection, events, text, closeAndDrain } = create('acp', 'acp-policy-allow-once-only')
    await connection.start(cwd)
    const sending = connection.send(input)

    const writeApproval = await waitForApproval(events)
    const writeOptions = LocalPermissionOptionsSchema.parse(writeApproval.request.input).localPermissionOptions
    const writeSessionOpt = writeOptions.find((option) => option.label === 'allow_session')
    expect(writeSessionOpt).toMatchObject({ decision: 'acceptForSession', label: 'allow_session' })
    if (!writeSessionOpt) throw new Error('Missing allow_session option')
    toolApprovalRegistry.dispatch(writeApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: writeSessionOpt.optionId }
    })

    // Second write auto-approves on the host; execute still prompts once with synthesized allow_session.
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2))
    const execApproval = events.filter((event) => event.type === 'tool-approval-request')[1]
    if (execApproval.type !== 'tool-approval-request') throw new Error('Missing execute approval')
    const execOptions = LocalPermissionOptionsSchema.parse(execApproval.request.input).localPermissionOptions
    const execSessionOpt = execOptions.find((option) => option.label === 'allow_session')
    expect(execSessionOpt).toBeDefined()
    if (!execSessionOpt) throw new Error('Missing execute allow_session option')
    toolApprovalRegistry.dispatch(execApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: execSessionOpt.optionId }
    })

    await sending
    expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2)
    expect(JSON.parse(text())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } }
    ])
    await closeAndDrain()
  })

  it('injects browser MCP into Codex thread config and child env, maps readOnly, normalizes mcpToolCall, and disposes lease', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    let capturedIsReadOnly: (() => boolean) | undefined
    const issueBrowserLease = vi.fn(async (inputArg: { isReadOnly?: () => boolean }) => {
      capturedIsReadOnly = inputArg.isReadOnly
      return {
        url: 'http://127.0.0.1:45555/mcp/codex-lease',
        token: 'codex-secret-token',
        headers: { Authorization: 'Bearer codex-secret-token' },
        dispose
      }
    })
    const existingSpy = vi.spyOn(application, 'getExisting').mockImplementation(((name: string) => {
      if (name === 'LocalAgentMcpBridgeService') return { issueBrowserLease }
      return undefined
    }) as typeof application.getExisting)

    try {
      const { connection, events, text, closeAndDrain } = create('codex', 'codex-browser-mcp', undefined, 'codex')
      await connection.start(cwd)
      expect(capturedIsReadOnly?.()).toBe(false)
      await connection.setMode?.('codex-mode', 'readOnly')
      expect(capturedIsReadOnly?.()).toBe(true)

      await connection.send(input)
      await closeAndDrain()

      expect(text()).toBe('codex-secret-token')
      expect(observedParts(events)).toContainEqual(
        expect.objectContaining({
          type: 'dynamic-tool',
          state: 'input-available',
          toolCallId: 'mcp-1',
          toolName: 'mcp__automation__js',
          input: { title: 'Inspect tab', code: 'await browser.getTab()' }
        })
      )
      expect(observedParts(events)).toContainEqual(
        expect.objectContaining({
          type: 'dynamic-tool',
          state: 'output-available',
          toolCallId: 'mcp-1',
          output: expect.objectContaining({
            content: expect.arrayContaining([expect.objectContaining({ text: 'Tab ready' })])
          })
        })
      )
      const wire = await readWire()
      expect(wire.find((m) => m.method === 'thread/start')?.params).toMatchObject({
        config: {
          'mcp_servers.automation.url': 'http://127.0.0.1:45555/mcp/codex-lease',
          'mcp_servers.automation.bearer_token_env_var': 'CHERRY_BROWSER_MCP_TOKEN',
          'mcp_servers.automation.enabled': true
        }
      })
      const spawnedArgv = JSON.parse(await readFile(path.join(cwd, 'wire.jsonl.argv.json'), 'utf8')) as string[]
      expect(spawnedArgv).toEqual(
        expect.arrayContaining([
          '-c',
          'mcp_servers.automation.url="http://127.0.0.1:45555/mcp/codex-lease"',
          'mcp_servers.automation.bearer_token_env_var="CHERRY_BROWSER_MCP_TOKEN"',
          'mcp_servers.automation.enabled=true',
          'mcp_servers.automation.tools.js.approval_mode="approve"',
          'mcp_servers.automation.tools.reset.approval_mode="approve"'
        ])
      )
      expect(dispose).toHaveBeenCalledTimes(1)

      // Headless Codex sessions must never receive browser MCP CLI flags or acquire a lease
      await rm(path.join(cwd, 'wire.jsonl'), { force: true })
      const headlessRun = create('codex', 'codex-browser-mcp', undefined, 'codex', undefined, true)
      await headlessRun.connection.start(cwd)
      await headlessRun.closeAndDrain()
      expect(issueBrowserLease).toHaveBeenCalledTimes(1)
      const headlessArgv = JSON.parse(await readFile(path.join(cwd, 'wire.jsonl.argv.json'), 'utf8')) as string[]
      expect(headlessArgv.join(' ')).not.toContain('mcp_servers.automation')
    } finally {
      existingSpy.mockRestore()
    }
  })

  it('injects HTTP or stdio shim MCP for ACP presets, skips custom ACP by default, auto-allows injected automation prompts, and disposes lease', async () => {
    const disposals: Array<ReturnType<typeof vi.fn>> = []
    const issueBrowserLease = vi.fn(async () => {
      const dispose = vi.fn().mockResolvedValue(undefined)
      disposals.push(dispose)
      return {
        url: 'http://127.0.0.1:46666/mcp/acp-lease',
        token: 'acp-secret-token',
        headers: { Authorization: 'Bearer acp-secret-token' },
        dispose
      }
    })
    const existingSpy = vi.spyOn(application, 'getExisting').mockImplementation(((name: string) => {
      if (name === 'LocalAgentMcpBridgeService') return { issueBrowserLease }
      if (name === 'PreferenceService') {
        return { get: (key: string) => key === 'app.browser.agent_control.enabled' }
      }
      return undefined
    }) as typeof application.getExisting)

    try {
      // HTTP-capable official preset
      const httpRun = create('acp', 'acp-http-mcp', undefined, 'copilot')
      await httpRun.connection.start(cwd)
      await httpRun.closeAndDrain()
      let wire = await readWire()
      expect(wire.find((m) => m.method === 'session/new')?.params?.mcpServers).toEqual([
        {
          type: 'http',
          name: 'automation',
          url: 'http://127.0.0.1:46666/mcp/acp-lease',
          headers: [{ name: 'Authorization', value: 'Bearer acp-secret-token' }]
        }
      ])

      // Stdio shim fallback + permission auto-allow when HTTP capability is absent
      await rm(path.join(cwd, 'wire.jsonl'), { force: true })
      const stdioRun = create('acp', 'acp-browser-permission', undefined, 'copilot')
      await stdioRun.connection.start(cwd)
      await stdioRun.connection.send(input)
      await stdioRun.closeAndDrain()
      expect(JSON.parse(stdioRun.text())).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
      wire = await readWire()
      const stdioServers = wire.find((m) => m.method === 'session/new')?.params?.mcpServers as Array<{
        name: string
        command: string
        args: string[]
        env: Array<{ name: string; value: string }>
      }>
      expect(stdioServers).toHaveLength(1)
      expect(stdioServers[0]).toMatchObject({
        name: 'automation',
        command: process.execPath
      })
      expect(stdioServers[0].args.join(' ')).not.toContain('acp-secret-token')
      expect(stdioServers[0].env).toContainEqual({ name: 'CHERRY_MCP_TOKEN', value: 'acp-secret-token' })

      // Copilot emits tool_call('automation-js') before request_permission('js') on the same toolCallId
      await rm(path.join(cwd, 'wire.jsonl'), { force: true })
      const copilotRun = create('acp', 'acp-copilot-browser-permission', undefined, 'copilot')
      await copilotRun.connection.start(cwd)
      await copilotRun.connection.send(input)
      await copilotRun.closeAndDrain()
      expect(JSON.parse(copilotRun.text())).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })

      // OpenClaw ACP bridge rejects per-session mcpServers, so it must not acquire a lease or pass mcpServers
      await rm(path.join(cwd, 'wire.jsonl'), { force: true })
      issueBrowserLease.mockClear()
      const openclawRun = create('acp', 'normal', undefined, 'openclaw')
      await openclawRun.connection.start(cwd)
      await openclawRun.closeAndDrain()
      expect(issueBrowserLease).not.toHaveBeenCalled()
      wire = await readWire()
      expect(wire.find((m) => m.method === 'session/new')?.params?.mcpServers).toEqual([])

      // Custom ACP without browserControl opt-in must NOT receive a browser lease
      await rm(path.join(cwd, 'wire.jsonl'), { force: true })
      issueBrowserLease.mockClear()
      const customRun = create('acp', 'normal', undefined, undefined)
      await customRun.connection.start(cwd)
      await customRun.closeAndDrain()
      expect(issueBrowserLease).not.toHaveBeenCalled()
      wire = await readWire()
      expect(wire.find((m) => m.method === 'session/new')?.params?.mcpServers).toEqual([])
      expect(disposals).toHaveLength(3)
      expect(disposals.every((fn) => fn.mock.calls.length === 1)).toBe(true)
    } finally {
      existingSpy.mockRestore()
    }
  })

  it('recognizes observed ACP client automation tool naming variants while rejecting non-automation tools', () => {
    for (const title of [
      'mcp__automation__js',
      'mcp__automation__reset',
      'automation-js',
      'automation_js',
      'automation: js',
      'automation/reset',
      'mcp_automation.js'
    ]) {
      expect(isInjectedAcpAutomationTool({ title, kind: 'other' }, undefined)).toBe(true)
    }
    for (const title of ['mcp:poolside__agent__automation:js', 'poolside__agent__automation__js']) {
      expect(isInjectedAcpAutomationTool({ title, kind: 'other' }, 'poolside')).toBe(true)
      expect(isInjectedAcpAutomationTool({ title, kind: 'other' }, 'codebuddy-code')).toBe(false)
    }
    const deferred = {
      title: 'DeferExecuteTool',
      kind: 'other',
      rawInput: { toolName: 'mcp__automation__js', params: { code: '1' } }
    } as const
    expect(isInjectedAcpAutomationTool(deferred, 'codebuddy-code')).toBe(true)
    expect(isInjectedAcpAutomationTool(deferred, undefined)).toBe(false)

    expect(isInjectedAcpAutomationTool({ title: 'js', kind: 'other' }, undefined)).toBe(false)
    expect(
      isInjectedAcpAutomationTool(
        {
          title: 'DeferExecuteTool',
          kind: 'other',
          rawInput: { toolName: 'Bash', params: { command: 'rm -rf /' } }
        },
        'codebuddy-code'
      )
    ).toBe(false)
    expect(isInjectedAcpAutomationTool({ title: 'mcp__automation__js', kind: 'execute' }, undefined)).toBe(false)
    expect(isInjectedAcpAutomationTool({ title: 'mcp__automation__js', kind: 'edit' }, undefined)).toBe(false)
  })

  it('honors synthesized allow_session grants across commands even when antigravity-acp runs in auto mode', async () => {
    const { connection, events, text, closeAndDrain } = create(
      'acp',
      'acp-policy-allow-once-only',
      undefined,
      'antigravity-acp'
    )
    await connection.start(cwd)
    await connection.setMode?.('agent-mode', 'auto')
    const sending = connection.send(input)

    const writeApproval = await waitForApproval(events)
    const writeSessionOpt = LocalPermissionOptionsSchema.parse(writeApproval.request.input).localPermissionOptions.find(
      (option) => option.decision === 'acceptForSession'
    )
    if (!writeSessionOpt) throw new Error('Missing acceptForSession option')
    toolApprovalRegistry.dispatch(writeApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: writeSessionOpt.optionId }
    })

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2))
    const execApproval = events.filter((event) => event.type === 'tool-approval-request')[1]
    if (execApproval.type !== 'tool-approval-request') throw new Error('Missing execute approval')
    const execSessionOpt = LocalPermissionOptionsSchema.parse(execApproval.request.input).localPermissionOptions.find(
      (option) => option.decision === 'acceptForSession'
    )
    if (!execSessionOpt) throw new Error('Missing execute acceptForSession option')
    toolApprovalRegistry.dispatch(execApproval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: execSessionOpt.optionId }
    })

    await sending
    expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(2)
    expect(JSON.parse(text())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } },
      { outcome: { outcome: 'selected', optionId: 'allow' } }
    ])
    await closeAndDrain()
  })

  it('routes antigravity interaction_* requests through AskUserQuestion and maps thinking category with role', async () => {
    const { connection, events, text, closeAndDrain } = create(
      'acp',
      'acp-antigravity-interaction',
      undefined,
      'antigravity-acp'
    )
    await connection.start(cwd)
    const sending = connection.send(input)
    const approval = await waitForApproval(events)
    expect(approval.request.toolName).toBe('AskUserQuestion')
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { action: 'submit', selections: [{ selected: ['Production'] }] }
    })
    await sending
    expect(JSON.parse(text())).toEqual({ outcome: { outcome: 'selected', optionId: 'opt-prod' } })
    await closeAndDrain()

    const thinking = create('acp', 'thought-thinking')
    await thinking.connection.start(cwd)
    expect(thinking.connection.localSessionInfo.thoughtLevel).toMatchObject({
      id: 'reasoning-budget',
      currentValue: 'balanced'
    })
    expect(thinking.connection.localSessionInfo.configOptions).not.toContainEqual(
      expect.objectContaining({ id: 'reasoning-budget' })
    )
    await thinking.closeAndDrain()
  })

  it('keeps a Codex thread usable when its active model advertises no effort choices', async () => {
    const { connection, text } = create('codex', 'codex-no-effort')
    await connection.start(cwd)
    expect(connection.localSessionInfo.thoughtLevel).toBeUndefined()
    await expect(connection.setThoughtLevel?.('codex-effort', 'high')).rejects.toThrow('no longer available')
    await connection.send(input)
    await vi.waitFor(() => expect(text()).toContain('hello'))
    const turn = (await readWire()).find(({ method }) => method === 'turn/start')
    expect(turn.params.effort).toBeUndefined()
  })

  it('keeps Codex request tokens while leaving an unreported window unknown', async () => {
    const known = create('codex', 'codex-usage', 'gpt-5-codex')
    await known.connection.start(cwd)
    expect(known.connection.localSessionInfo.thoughtLevel?.options).toContainEqual({
      value: 'ultra',
      name: 'Ultra',
      description: 'Deepest'
    })
    await known.connection.send(input)
    await vi.waitFor(() =>
      expect(known.events.some((event) => event.type === 'context-usage' && event.result.status === 'confirmed')).toBe(
        true
      )
    )
    expect(known.events).toContainEqual({
      type: 'context-usage',
      result: {
        status: 'confirmed',
        value: {
          model: 'gpt-5-codex',
          revision: expect.any(String),
          basis: 'last-request',
          used: { tokens: 200, precision: 'reported' }
        }
      }
    })
    await known.closeAndDrain()

    const nativeWindow = create('codex', 'codex-usage-native-window', 'codex/gpt-6.2-sol')
    await nativeWindow.connection.start(cwd)
    await nativeWindow.connection.send(input)
    await vi.waitFor(() =>
      expect(
        nativeWindow.events.some((event) => event.type === 'context-usage' && event.result.status === 'confirmed')
      ).toBe(true)
    )
    expect(nativeWindow.events).toContainEqual({
      type: 'context-usage',
      result: {
        status: 'confirmed',
        value: expect.objectContaining({
          contextWindow: 258_400,
          basis: 'last-request',
          used: { tokens: 250, precision: 'reported' }
        })
      }
    })
    await nativeWindow.closeAndDrain()
  })

  it('preserves ACP context occupancy when the agent reports no window', async () => {
    const zeroSize = create('acp', 'acp-usage-zero-size', 'google/gemini-4-neon')
    await zeroSize.connection.start(cwd)
    await zeroSize.connection.send(input)
    await zeroSize.closeAndDrain()
    expect(zeroSize.events).toContainEqual({
      type: 'context-usage',
      result: {
        status: 'confirmed',
        value: {
          model: 'google/gemini-4-neon',
          revision: expect.any(String),
          basis: 'current-context',
          used: { tokens: 5000, precision: 'reported' }
        }
      }
    })
  })

  it('forwards Antigravity warnings when granting session approval', async () => {
    const agyWarn = create('acp', 'acp-antigravity-warning-grant', undefined, 'antigravity-acp')
    await agyWarn.connection.start(cwd)
    const sending = agyWarn.connection.send(input)
    const approval = await waitForApproval(agyWarn.events)
    const options = LocalPermissionOptionsSchema.parse(approval.request.input).localPermissionOptions
    expect(options).toContainEqual({
      optionId: 'always-native',
      decision: 'acceptForSession',
      label: 'allow_session',
      name: 'Always Allow',
      warning: 'Allows shell commands for this thread.'
    })
    toolApprovalRegistry.dispatch(approval.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'always-native' }
    })
    await sending
    expect(agyWarn.events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(1)
    expect(JSON.parse(agyWarn.text())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'always-native' } },
      { outcome: { outcome: 'selected', optionId: 'once' } }
    ])
    await agyWarn.closeAndDrain()
  })

  it('keeps ACP prompt billing separate from context occupancy', async () => {
    const promptFallback = create('acp', 'acp-usage-prompt-fallback', 'claude-sonnet-4-6')
    await promptFallback.connection.start(cwd)
    await promptFallback.connection.send(input)
    await promptFallback.closeAndDrain()

    expect(promptFallback.events).toContainEqual(
      expect.objectContaining({
        type: 'local-turn-usage',
        summary: expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 100 }) })
      })
    )
    expect(
      promptFallback.events.some((event) => event.type === 'context-usage' && event.result.status === 'confirmed')
    ).toBe(false)

    const noUsage = create('acp', 'normal')
    await noUsage.connection.start(cwd)
    await noUsage.connection.send(input)
    await noUsage.connection.send(input)
    await noUsage.closeAndDrain()

    expect(noUsage.events.filter((event) => event.type === 'context-usage')).toEqual([
      {
        type: 'context-usage',
        result: {
          status: 'unsupported',
          error: {
            operation: 'contextUsage',
            code: 'unsupported',
            message: 'This agent does not report context usage'
          }
        }
      }
    ])
  })

  it('handles plain ACP permission approvals/denials and Antigravity interaction cancellation', async () => {
    const parseJsonOutcome = (raw: string) => JSON.parse(raw.slice(raw.indexOf('{')))

    const allowRun = create('acp', 'permission')
    await allowRun.connection.start(cwd)
    const allowing = allowRun.connection.send(input)
    const allowReq = await waitForApproval(allowRun.events)
    toolApprovalRegistry.dispatch(allowReq.request.approvalId, { approved: true })
    await allowing
    expect(parseJsonOutcome(allowRun.text())).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
    await allowRun.closeAndDrain()

    const denyRun = create('acp', 'permission')
    await denyRun.connection.start(cwd)
    const denying = denyRun.connection.send(input)
    const denyReq = await waitForApproval(denyRun.events)
    toolApprovalRegistry.dispatch(denyReq.request.approvalId, { approved: false })
    await denying
    expect(parseJsonOutcome(denyRun.text())).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } })
    await denyRun.closeAndDrain()

    const cancelInteraction = create('acp', 'acp-antigravity-interaction', undefined, 'antigravity-acp')
    await cancelInteraction.connection.start(cwd)
    const cancelling = cancelInteraction.connection.send(input)
    const interactionReq = await waitForApproval(cancelInteraction.events)
    toolApprovalRegistry.dispatch(interactionReq.request.approvalId, { approved: false })
    await cancelling
    expect(parseJsonOutcome(cancelInteraction.text())).toEqual({ outcome: { outcome: 'cancelled' } })
    await cancelInteraction.closeAndDrain()
  })

  it('maps Codex interactive approval options to unified decisions and honors permissions scope', async () => {
    const { connection, events, text, closeAndDrain } = create('codex', 'codex-interactive-approvals')
    await connection.start(cwd)
    const sending = connection.send(input)

    const cmdReq = await waitForApproval(events, 0)
    const cmdOptions = LocalPermissionOptionsSchema.parse(cmdReq.request.input).localPermissionOptions
    expect(cmdOptions.map((option) => option.decision)).toEqual([
      'accept',
      'acceptForSession',
      'acceptAlways',
      'acceptAlways',
      'decline',
      'decline',
      'cancel'
    ])
    const execPolicyOption = cmdOptions.find((option) => option.name.startsWith('Always allow: git status'))
    if (!execPolicyOption) throw new Error('Missing execpolicy option')
    toolApprovalRegistry.dispatch(cmdReq.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: execPolicyOption.optionId }
    })

    const perm1Req = await waitForApproval(events, 1)
    expect(LocalPermissionOptionsSchema.parse(perm1Req.request.input).localPermissionOptions).toEqual([
      { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
      { optionId: 'acceptForSession', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
      { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' }
    ])
    toolApprovalRegistry.dispatch(perm1Req.request.approvalId, {
      approved: true,
      updatedInput: { localPermissionOption: 'acceptForSession' }
    })

    const perm2Req = await waitForApproval(events, 2)
    toolApprovalRegistry.dispatch(perm2Req.request.approvalId, {
      approved: false,
      updatedInput: { localPermissionOption: 'decline' }
    })

    await sending
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'turn-complete' })))
    expect(JSON.parse(text())).toEqual({
      cmd: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } } },
      p1: { permissions: { fileSystem: { read: null, write: [cwd] } }, scope: 'session' },
      p2: { permissions: {}, scope: 'turn' }
    })
    await closeAndDrain()
  })
})
