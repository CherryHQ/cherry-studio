import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV, type BridgePolicy } from '@cherrystudio/dsh-bridge'
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
