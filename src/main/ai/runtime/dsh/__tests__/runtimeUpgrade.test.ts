import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV, type BridgePolicy } from '@cherrystudio/dsh-bridge'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { expect, it } from 'vitest'

import { buildDshCompositionYaml, resolveDshRuntimeBinPath } from '../compositionBuilder'
import { DshBridgeServer } from '../DshBridgeServer'
import { loadDshSdk } from '../dshSdk'

it('boots the packaged rc.1 runtime and resumes its persisted session without a model request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-upgrade-'))
  const sessionId = randomUUID()
  const policy: BridgePolicy = {
    permissionMode: 'default',
    disabledTools: [],
    allowedRoots: [root],
    readTools: [],
    editTools: [],
    autoApprovedTools: [],
    approvalRequiredTools: [],
    nonBypassableApprovalTools: [],
    planSafeTools: []
  }
  const { HarnessClient } = await loadDshSdk()

  try {
    for (const resume of [false, true]) {
      const bridge = new DshBridgeServer({
        sessionId,
        emit: () => undefined,
        getInteractionState: () => ({ userResponse: 'unavailable' }),
        onToolCall: async () => {
          throw new Error('This smoke test must not execute tools')
        },
        onGuardCheck: async () => {
          throw new Error('This smoke test must not request tool execution')
        }
      })
      const compositionPath = path.join(root, 'cordis.yml')
      await writeFile(
        compositionPath,
        buildDshCompositionYaml({
          providerName: 'cherry-upgrade-test',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:1/v1',
          modelConfig: {
            id: 'test-model',
            name: 'Offline test model',
            contextWindow: 128000,
            maxTokens: 4096,
            input: ['text'],
            reasoningEfforts: false
          },
          workspacePath: root,
          dshRoot: root,
          sessionsRoot: path.join(root, 'sessions'),
          permissionMode: 'default',
          persona: 'Offline runtime compatibility test.',
          customBase: true,
          skillDirs: []
        })
      )
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
      try {
        await bridge.listen()
        client.start()
        await client.initialize({ cwd: root, provider: 'cherry-upgrade-test', model: 'test-model' })
        await bridge.whenReady()
        await expect(
          bridge.request('session/open', {
            sessionId,
            provider: 'cherry-upgrade-test',
            model: 'test-model',
            cwd: root,
            resume,
            policy,
            tools: []
          })
        ).resolves.toEqual({})
        await expect(bridge.request('command/execute', { sessionId, line: '/not-a-command' })).resolves.toEqual({
          handled: false
        })
        const usage = await bridge.request('context/usage', { sessionId })
        expect(usage.totalTokens).toBeGreaterThanOrEqual(0)
        await expect(bridge.request('plan/set', { sessionId, active: true })).resolves.toEqual({
          outcome: resume ? 'noop' : 'committed'
        })
      } finally {
        await client.close()
        await bridge.close()
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

it.each([
  { approved: false, reason: 'Use a copy instead of modifying the original.' },
  { approved: false, reason: '' },
  { approved: true, reason: 'This must not become rejection feedback.' }
])(
  'delivers approval decisions in the next model step ($approved, $reason)',
  async ({ approved, reason }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-approval-'))
    const sessionId = randomUUID()
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    let executions = 0
    let approvals = 0
    const server = createServer(async (request, response) => {
      let body = ''
      request.setEncoding('utf8')
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      const firstStep = requests.length === 1
      const delta = firstStep
        ? {
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'approval-call', type: 'function', function: { name: 'approval_probe', arguments: '{}' } }
            ]
          }
        : { role: 'assistant', content: 'Understood.' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        [
          `data: ${JSON.stringify({ choices: [{ delta, index: 0, finish_reason: null }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: firstStep ? 'tool_calls' : 'stop' }] })}`,
          'data: [DONE]',
          ''
        ].join('\n\n')
      )
    })
    const bridge = new DshBridgeServer({
      sessionId,
      emit: (event) => {
        if (event.type !== 'tool-approval-request') return
        approvals++
        toolApprovalRegistry.dispatch(event.request.approvalId, { approved, reason })
      },
      getInteractionState: () => ({ userResponse: 'stream' }),
      onToolCall: async () => {
        executions++
        return { text: 'Approved tool executed.' }
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
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port')
      await writeFile(
        compositionPath,
        buildDshCompositionYaml({
          providerName: 'cherry-approval-test',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          modelConfig: {
            id: 'test-model',
            name: 'Offline test model',
            contextWindow: 128000,
            maxTokens: 4096,
            input: ['text'],
            reasoningEfforts: false
          },
          workspacePath: root,
          dshRoot: root,
          sessionsRoot: path.join(root, 'sessions'),
          permissionMode: 'default',
          persona: 'Approval feedback regression test.',
          customBase: true,
          skillDirs: []
        })
      )
      await bridge.listen()
      client.start()
      await client.initialize({ cwd: root, provider: 'cherry-approval-test', model: 'test-model' })
      await bridge.whenReady()
      await bridge.request('session/open', {
        sessionId,
        provider: 'cherry-approval-test',
        model: 'test-model',
        cwd: root,
        resume: false,
        policy: {
          permissionMode: 'default',
          disabledTools: [],
          allowedRoots: [root],
          readTools: [],
          editTools: [],
          autoApprovedTools: [],
          approvalRequiredTools: ['approval_probe'],
          nonBypassableApprovalTools: [],
          planSafeTools: []
        },
        tools: [
          {
            name: 'approval_probe',
            description: 'A tool requiring approval.',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      })
      await bridge.request('session/prompt', {
        sessionId,
        contentBlocks: [{ type: 'text', text: 'Run approval_probe.' }]
      })
      await expect.poll(() => requests.length, { timeout: 20000 }).toBeGreaterThanOrEqual(2)
      expect(approvals).toBe(1)
      expect(executions).toBe(approved ? 1 : 0)
      const messages = JSON.stringify(requests[1].messages)
      if (!approved && reason) {
        expect(messages).toContain(reason)
      } else {
        expect(messages).not.toContain('Tool approval feedback')
      }
      expect(messages).toContain(approved ? 'Approved tool executed.' : 'the user rejected tool')
      expect(requests[1].messages.some((message) => message.role === 'tool')).toBe(true)
    } finally {
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
