import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { client, type CreateElicitationRequest, ndJsonStream } from '@agentclientprotocol/sdk'
import { expect, it } from 'vitest'

import { piAcpAdapter } from '../src/adapter'

async function startBridge() {
  const root = await mkdtemp(path.join(tmpdir(), 'pi-adapter-contract-'))
  const fixture = fileURLToPath(new URL('./fixtures/piRpc.mjs', import.meta.url))
  await mkdir(path.join(root, 'agent'))
  await writeFile(path.join(root, 'agent', 'settings.json'), JSON.stringify({ quietStartup: true }))
  const entry = process.env.PI_ADAPTER_TEST_ENTRY || createRequire(import.meta.url).resolve('pi-acp')
  const statsLog = path.join(root, 'stats.log')
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      HOME: root,
      PI_CODING_AGENT_DIR: path.join(root, 'agent'),
      PI_ACP_PI_COMMAND: fixture,
      PI_FIXTURE_STATS_LOG: statsLog
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return { root, statsLog, child }
}

it.skipIf(process.platform === 'win32').each([
  { method: 'input', forms: true, action: 'accept', value: '' },
  { method: 'editor', forms: true, action: 'accept', value: '  first\nsecond\n' },
  { method: 'editor', forms: true, action: 'decline' },
  { method: 'input', forms: true, action: 'cancel' },
  { method: 'input', forms: false, action: 'cancel' }
] as const)('answers the original Pi $method request (forms=$forms, action=$action)', async (scenario) => {
  const { root, child } = await startBridge()
  const forms: CreateElicitationRequest[] = []
  const connection = client({ name: 'cherry-test' })
    .onRequest('elicitation/create', ({ params }) => {
      forms.push(params)
      return scenario.action === 'accept'
        ? { action: 'accept', content: { value: scenario.value } }
        : { action: scenario.action }
    })
    .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>))
  try {
    await connection.agent.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: scenario.forms ? { elicitation: { form: {} } } : {}
    })
    const { sessionId } = await connection.agent.request('session/new', { cwd: root, mcpServers: [] })
    await connection.agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: scenario.method }] })
    if (scenario.forms) {
      expect(forms).toHaveLength(1)
      expect(forms[0]).toMatchObject({
        mode: 'form',
        sessionId,
        message: 'Release notes',
        requestedSchema: {
          properties: {
            value: scenario.method === 'editor' ? { default: 'first\nsecond' } : { description: 'Enter notes' }
          },
          required: ['value']
        }
      })
    } else expect(forms).toEqual([])
    expect(JSON.parse(await readFile(path.join(root, 'ui-response.json'), 'utf8'))).toEqual({
      type: 'extension_ui_response',
      id: 'extension-dialog',
      ...(scenario.action === 'accept' ? { value: scenario.value } : { cancelled: true })
    })
  } finally {
    connection.close()
    child.kill()
    await rm(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform === 'win32')(
  'reports final Pi failures without misclassifying recovered retries',
  async () => {
    const { root, statsLog, child } = await startBridge()
    const reads = async () => (await readFile(statsLog, 'utf8')).trim().split('\n').length
    const commandsReady = Promise.withResolvers<void>()
    let onRunning: (() => void) | undefined
    const connection = client({ name: 'cherry-test' })
      .onNotification('session/update', ({ params }) => {
        if (params.update.sessionUpdate === 'available_commands_update') commandsReady.resolve()
        if (
          params.update.sessionUpdate === 'session_info_update' &&
          params.update._meta?.piAcp &&
          (params.update._meta.piAcp as { running?: boolean }).running
        )
          onRunning?.()
      })
      .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>))
    try {
      const handshake = await connection.agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} })
      const session = await connection.agent.request('session/new', { cwd: root, mcpServers: [] })
      await commandsReady.promise
      const prompt = (text: string) =>
        connection.agent.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] })
      await expect(prompt('request-error')).rejects.toThrow('Fixture RPC rejected prompt')
      await expect(prompt('error')).rejects.toThrow('Fixture provider rejected the model')
      await expect(prompt('retry-success')).resolves.toMatchObject({
        stopReason: 'end_turn',
        usage: {
          inputTokens: 5526,
          outputTokens: 150,
          totalTokens: 5676,
          cachedReadTokens: 0,
          cachedWriteTokens: 5523,
          thoughtTokens: 116
        }
      })
      await expect(prompt('length')).resolves.toMatchObject({ stopReason: 'max_tokens' })
      await expect(prompt('normal')).resolves.toMatchObject({
        stopReason: 'end_turn',
        usage: {
          inputTokens: 5526,
          outputTokens: 150,
          totalTokens: 5676,
          cachedReadTokens: 0,
          cachedWriteTokens: 5523,
          thoughtTokens: 116
        }
      })
      const context = piAcpAdapter.bind({
        agent: connection.agent,
        agentCapabilities: handshake.agentCapabilities,
        sessionId: session.sessionId,
        newSessionMetadata: session._meta,
        currentModel: () => 'test/fixture'
      })
      if (!context.contextAfterPrompt || !context.inspectContextUsage)
        throw new Error('Bundled Pi bridge did not advertise context usage')
      const observedPrompt = (text: string) =>
        connection.agent.request('session/prompt', {
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text }],
          _meta: context.promptMeta
        })
      const before = await reads()
      const multiple = await observedPrompt('multiple')
      expect(multiple).toMatchObject({ usage: { inputTokens: 11052 } })
      expect(context.contextAfterPrompt(multiple, 'reply')).toMatchObject({
        model: 'test/fixture',
        revision: 'reply',
        contextWindow: 16000,
        basis: 'last-request',
        used: { tokens: 5526, precision: 'reported' }
      })
      expect(await reads()).toBe(before)
      await expect(context.inspectContextUsage()).resolves.toMatchObject({
        status: 'confirmed',
        value: { basis: 'current-context', used: { tokens: 7000 } }
      })
      expect(await reads()).toBe(before + 1)
      expect(context.contextAfterPrompt(await observedPrompt('compacted'), 'reply')).toBeUndefined()
      expect(await reads()).toBe(before + 2)
      const running = new Promise<void>((resolve) => {
        onRunning = resolve
      })
      const cancelled = prompt('cancel')
      await running
      await connection.agent.notify('session/cancel', { sessionId: session.sessionId })
      await expect(cancelled).resolves.toMatchObject({ stopReason: 'cancelled' })
    } finally {
      connection.close()
      child.kill()
      await rm(root, { recursive: true, force: true })
    }
  },
  20000
)
