import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from '@cherrystudio/dsh-bridge'
import type { SessionEventNotification } from '@deepseek-ai/dsh-sdk-protocol'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { expect, it } from 'vitest'

import { buildDshCompositionYaml, resolveDshRuntimeBinPath } from '../compositionBuilder'
import { DshBridgeServer } from '../DshBridgeServer'
import { loadDshSdk } from '../dshSdk'

it.each([
  { mode: 'bypassPermissions', repeat: true },
  { mode: 'bypassPermissions', repeat: false },
  { mode: 'default', repeat: false }
] as const)(
  'bounds invalid shell escalation ($mode, repeat=$repeat)',
  async ({ mode, repeat }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-escalation-'))
    const sessionId = randomUUID()
    const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
    const fullAccess = mode === 'bypassPermissions'
    const requests: Array<{
      messages: unknown[]
      tools: Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>
    }> = []
    let approvals = 0
    const server = createServer(async (request, response) => {
      let body = ''
      request.setEncoding('utf8')
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      // Even a model ignoring the corrected schema must not keep the turn alive.
      const call = requests.length === 1 || (repeat && requests.length <= 4)
      const delta = call
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${requests.length}`,
                type: 'function',
                function: {
                  name: shell,
                  arguments: JSON.stringify({
                    command: 'echo escalation-test',
                    description: 'Print an escalation test marker',
                    sandbox_permissions: 'danger-full-access',
                    justification: 'Test the escalation boundary.'
                  })
                }
              }
            ]
          }
        : { role: 'assistant', content: 'Stopped requesting escalation.' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        [
          `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}`,
          'data: [DONE]',
          ''
        ].join('\n\n')
      )
    })
    const bridge = new DshBridgeServer({
      sessionId,
      emit: (event) => {
        if (event.type === 'tool-approval-request') {
          approvals++
          toolApprovalRegistry.dispatch(event.request.approvalId, { approved: false })
        }
      },
      getInteractionState: () => ({ userResponse: 'stream' }),
      onToolCall: async () => {
        throw new Error('No host tool should execute')
      },
      onGuardCheck: async () => ({ kind: 'allow' })
    })
    const { HarnessClient } = await loadDshSdk()
    const compositionPath = path.join(root, 'cordis.yml')
    const client = new HarnessClient({
      dshBin: resolveDshRuntimeBinPath(),
      profile: 'cherry',
      processCwd: root,
      env: {
        ...process.env,
        CHERRY_DSH_CONFIG: compositionPath,
        CHERRY_DSH_API_KEY: 'offline-test-key',
        DSH_HOME: root,
        [BRIDGE_SOCKET_ENV]: bridge.socketPath,
        [BRIDGE_TOKEN_ENV]: bridge.authenticationToken
      },
      initializeTimeoutMs: 20000,
      requestTimeoutMs: 10000
    })
    const subscription = client.subscribe(
      (notification) => notification.method === 'session.event' && notification.params.sessionId === sessionId
    )
    const events: SessionEventNotification['event'][] = []
    const completedTurns = () => {
      let notification = subscription.tryNext()
      while (notification) {
        events.push((notification.params as unknown as SessionEventNotification).event)
        notification = subscription.tryNext()
      }
      return events.filter((event) => event.type === 'turn/end')
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing HTTP test address')
      await writeFile(
        compositionPath,
        buildDshCompositionYaml({
          providerName: 'cherry-escalation-test',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          modelConfig: {
            id: 'test-model',
            name: 'Offline model',
            contextWindow: 128000,
            maxTokens: 4096,
            input: ['text'],
            reasoningEfforts: false
          },
          workspacePath: root,
          dshRoot: root,
          sessionsRoot: path.join(root, 'sessions'),
          permissionMode: mode,
          persona: 'Escalation regression test.',
          customBase: true,
          skillDirs: []
        })
      )
      await bridge.listen()
      client.start()
      await client.initialize({ cwd: root, provider: 'cherry-escalation-test', model: 'test-model' })
      await bridge.whenReady()
      await bridge.request('session/open', {
        sessionId,
        provider: 'cherry-escalation-test',
        model: 'test-model',
        cwd: root,
        resume: false,
        policy: {
          permissionMode: mode,
          disabledTools: [],
          allowedRoots: [root],
          readTools: [],
          editTools: [],
          autoApprovedTools: [],
          approvalRequiredTools: [],
          nonBypassableApprovalTools: [],
          planSafeTools: []
        },
        tools: []
      })
      await bridge.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'Check the shell.' }] })
      await expect.poll(completedTurns, { timeout: 20000 }).toHaveLength(1)
      expect(requests).toHaveLength(2)
      const schema = requests[0].tools.find((tool) => tool.function.name === shell)?.function.parameters.properties
      expect(schema).toBeDefined()
      expect(Object.hasOwn(schema!, 'sandbox_permissions')).toBe(!fullAccess)
      expect(Object.hasOwn(schema!, 'justification')).toBe(!fullAccess)
      if (fullAccess) {
        expect(approvals).toBe(0)
        expect(JSON.stringify(requests[1].messages)).toContain('not strictly wider')
        expect(JSON.stringify(requests[1].messages)).toContain('Remove sandbox_permissions and justification')
      } else {
        expect(approvals).toBeGreaterThan(0)
        expect(JSON.stringify(requests[1].messages)).not.toContain('Remove sandbox_permissions and justification')
      }
      expect(events.find((event) => event.type === 'turn/end')?.data).toMatchObject({
        reason: { kind: repeat ? 'blocked' : 'completed' }
      })
      expect(events.filter((event) => event.type === 'tool/result')).toHaveLength(repeat ? 2 : 1)
      if (repeat) {
        await bridge.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'Continue.' }] })
        await expect.poll(completedTurns, { timeout: 20000 }).toHaveLength(2)
        expect(requests).toHaveLength(4)
        expect(completedTurns()[1].data).toMatchObject({ reason: { kind: 'blocked' } })
      }
    } finally {
      subscription.close()
      await client.close()
      await bridge.close()
      toolApprovalRegistry.abort(sessionId)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  60000
)
