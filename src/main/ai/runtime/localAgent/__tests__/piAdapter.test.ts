import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { client, ndJsonStream } from '@agentclientprotocol/sdk'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')(
  'reports final Pi failures without misclassifying recovered retries',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-adapter-contract-'))
    const fixture = fileURLToPath(new URL('./fixtures/piRpc.mjs', import.meta.url))
    await chmod(fixture, 0o755)
    await mkdir(path.join(root, 'agent'))
    await writeFile(path.join(root, 'agent', 'settings.json'), JSON.stringify({ quietStartup: true }))
    const entry = process.env.PI_ADAPTER_TEST_ENTRY || createRequire(import.meta.url).resolve('pi-acp')
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: path.join(root, 'agent'), PI_ACP_PI_COMMAND: fixture },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let onRunning: (() => void) | undefined
    const connection = client({ name: 'cherry-test' })
      .onNotification('session/update', ({ params }) => {
        if (
          params.update.sessionUpdate === 'session_info_update' &&
          params.update._meta?.piAcp &&
          (params.update._meta.piAcp as { running?: boolean }).running
        )
          onRunning?.()
      })
      .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>))
    try {
      await connection.agent.request('initialize', { protocolVersion: 1, clientCapabilities: {} })
      const session = await connection.agent.request('session/new', { cwd: root, mcpServers: [] })
      const prompt = (text: string) =>
        connection.agent.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] })
      await expect(prompt('request-error')).rejects.toThrow('Fixture RPC rejected prompt')
      await expect(prompt('error')).rejects.toThrow('Fixture provider rejected the model')
      await expect(prompt('retry-success')).resolves.toMatchObject({ stopReason: 'end_turn' })
      await expect(prompt('length')).resolves.toMatchObject({ stopReason: 'max_tokens' })
      await expect(prompt('normal')).resolves.toMatchObject({ stopReason: 'end_turn' })
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
