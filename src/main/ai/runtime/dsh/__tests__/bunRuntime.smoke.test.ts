import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'

import { application } from '@application'
import { BRIDGE_SOCKET_ENV, BRIDGE_TOKEN_ENV } from '@cherrystudio/dsh-bridge'

import { resolveDshBunRuntime } from '../bunRuntime'
import { buildDshCompositionYaml, resolveDshRuntimeBinPath } from '../compositionBuilder'
import { DshBridgeServer } from '../DshBridgeServer'

// Explicit opt-in: this exercises native payloads and an actual runtime process.
it.skipIf(process.env.CHERRY_DSH_SMOKE !== '1')(
  'boots bundled Bun, decodes an image, runs a sandboxed shell and spawns a child',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-dsh-smoke-'))
    const packagedRoot = process.env.CHERRY_DSH_SMOKE_UNPACKED
    const resources = packagedRoot ? path.join(packagedRoot, 'resources/binaries') : path.resolve('resources/binaries')
    const runtimeDir = packagedRoot ? path.join(root, 'node_modules/@cherrystudio/dsh-bridge/dist/runtime') : undefined
    vi.spyOn(application, 'getPath').mockImplementation((key) => {
      if (key === 'app.root.resources.binaries') return resources
      throw new Error(`Unexpected smoke path: ${key}`)
    })
    const events: any[] = []
    const childEdges: any[] = []
    const requests: any[] = []
    const imagePath = path.join(root, 'pixel.png')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR4nGP4z8AARAwoFABE0AX7pM/egAAAAABJRU5ErkJggg==',
      'base64'
    )
    await writeFile(imagePath, png)
    // A workspace .env must not inject settings into the runtime.
    await writeFile(path.join(root, '.env'), 'CHERRY_DSH_SMOKE_LEAK=unexpected\n')
    await writeFile(path.join(root, 'bunfig.toml'), 'preload = ["./preload.mjs"]\n')
    await writeFile(path.join(root, 'preload.mjs'), 'throw new Error("Workspace Bun preload executed")\n')
    const shellTool = process.platform === 'win32' ? 'pwsh' : 'bash'
    const calls = [
      { name: 'read_image', arguments: { file_path: imagePath } },
      {
        name: shellTool,
        arguments: {
          command:
            process.platform === 'win32'
              ? 'if ($env:CHERRY_DSH_SMOKE_LEAK -or -not (Test-Path -LiteralPath "./pixel.png")) { exit 1 }; echo cherry-bun-shell-ok'
              : 'test -z "$CHERRY_DSH_SMOKE_LEAK" && test -f ./pixel.png && echo cherry-bun-shell-ok',
          description: 'Check environment isolation and workspace access'
        }
      },
      { name: 'subagent', arguments: { description: 'Validate Bun child runtime', prompt: 'cherry-bun-child-probe' } }
    ]
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const payload = JSON.parse(body)
      requests.push(payload)
      const isChild = payload.messages.some(
        (message: any) => message.role === 'user' && JSON.stringify(message.content).includes('cherry-bun-child-probe')
      )
      const completed = payload.messages.filter((message: any) => message.role === 'tool').length
      const call = isChild ? undefined : calls[completed]
      const delta = call
        ? {
            tool_calls: [
              {
                index: 0,
                id: `smoke-${completed}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) }
              }
            ]
          }
        : { content: isChild ? 'cherry-bun-child-ok' : 'cherry-bun-parent-ok' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        [
          JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] }),
          JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }),
          '[DONE]'
        ]
          .map((line) => `data: ${line}\n\n`)
          .join('')
      )
    })
    const bridge = new DshBridgeServer({
      sessionId: 'bun-smoke',
      emit: () => {},
      getInteractionState: () => ({ userResponse: 'unavailable' }),
      onToolCall: async () => {
        throw new Error('Unexpected bridged tool')
      },
      onGuardCheck: async () => ({ kind: 'allow' }),
      onSubagentLifecycle: (edge) => childEdges.push(edge)
    })
    let client: HarnessClient | undefined
    try {
      if (packagedRoot) {
        // Isolate the payload so missing packaged dependencies cannot resolve from the checkout.
        await cp(path.join(packagedRoot, 'node_modules'), path.join(root, 'node_modules'), { recursive: true })
      }
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing smoke server port')
      const yaml = buildDshCompositionYaml({
        providerName: 'smoke',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        modelConfig: {
          id: 'smoke',
          name: 'Smoke',
          reasoningEfforts: false,
          input: ['text', 'image'],
          contextWindow: 128_000,
          maxTokens: 4096
        },
        workspacePath: root,
        dshRoot: root,
        sessionsRoot: path.join(root, 'sessions'),
        permissionMode: 'default',
        persona: '',
        customBase: false,
        skillDirs: []
      })
      const entries = parse(yaml)
      if (runtimeDir) {
        for (const entry of entries)
          entry.name = pathToFileURL(path.join(runtimeDir, path.basename(new URL(entry.name).pathname))).href
      }
      const composition = path.join(root, 'composition.yml')
      await writeFile(composition, stringify(entries))
      await bridge.listen()
      const dshBin = runtimeDir ? path.join(runtimeDir, 'bin.mjs') : resolveDshRuntimeBinPath()
      client = new HarnessClient({
        runtimeExecutable: await resolveDshBunRuntime(),
        runtimeArgs: ['--no-env-file'],
        dshBin,
        profile: 'cherry',
        processCwd: path.dirname(dshBin),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          SYSTEMROOT: process.env.SYSTEMROOT,
          CHERRY_DSH_API_KEY: 'smoke',
          CHERRY_DSH_CONFIG: composition,
          DSH_HOME: root,
          [BRIDGE_SOCKET_ENV]: bridge.socketPath,
          [BRIDGE_TOKEN_ENV]: bridge.authenticationToken
        }
      })
      await client.initialize({ cwd: root, provider: 'smoke', model: 'smoke' })
      await bridge.whenReady()
      await bridge.request('session/open', {
        sessionId: 'bun-smoke',
        provider: 'smoke',
        model: 'smoke',
        cwd: root,
        resume: false,
        tools: [],
        policy: {
          permissionMode: 'bypassPermissions',
          disabledTools: [],
          allowedRoots: [root],
          readTools: ['read_image'],
          editTools: [],
          autoApprovedTools: [],
          approvalRequiredTools: [],
          nonBypassableApprovalTools: [],
          planSafeTools: []
        }
      })
      const subscription = client.subscribe()
      let closingSubscription = false
      const collect = (async () => {
        for await (const notification of subscription) {
          if (notification.method === 'session.event') events.push(notification.params)
        }
      })().catch((error) => {
        if (!closingSubscription) throw error
      })
      try {
        await bridge.request('session/prompt', {
          sessionId: 'bun-smoke',
          contentBlocks: [{ type: 'text', text: 'Run the runtime smoke checks.' }]
        })
        await vi.waitFor(
          () => {
            expect(JSON.stringify(events)).toContain('cherry-bun-parent-ok')
            expect(JSON.stringify(events)).toContain('cherry-bun-child-ok')
            const ended = events.filter((item) => item.event.type === 'turn/end')
            expect(
              ended.some((item) => item.sessionId === 'bun-smoke' && item.event.data.reason.kind === 'completed')
            ).toBe(true)
            expect(
              ended.some((item) => item.sessionId !== 'bun-smoke' && item.event.data.reason.kind === 'completed')
            ).toBe(true)
          },
          { timeout: 45_000, interval: 100 }
        )
        const results = events.filter((item) => item.event.type === 'tool/result')
        expect(results.length).toBeGreaterThanOrEqual(3)
        for (const result of results) {
          expect(result.event.data.message.content).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: 'tool-result', isError: false })])
          )
        }
        expect(JSON.stringify(results)).toContain('cherry-bun-shell-ok')
        expect(requests.some((payload) => JSON.stringify(payload.messages).includes('data:image/png;base64,'))).toBe(
          true
        )
        expect(childEdges.length).toBeGreaterThan(0)
        expect(await readFile(imagePath)).toEqual(png)
        process.stdout.write(
          `DSH Bun smoke passed (${process.platform}-${process.arch}, ${packagedRoot ? 'packaged' : 'development'} payload)\n`
        )
      } finally {
        closingSubscription = true
        subscription.close()
        await collect
      }
    } finally {
      await client?.close()
      await bridge.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      vi.restoreAllMocks()
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000
)
