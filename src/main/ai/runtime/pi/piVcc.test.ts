import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type AssistantMessage
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent
} from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

import { createPiApprovalExtension } from './approvalExtension'
import { getPiVccExtensionPath } from './piSdk'

it('ships the TypeScript runtime without bundling package demos or tests', () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
  const root = process.cwd()
  const config = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as { files: string[] }
  const filter = new FileMatcher(root, root, (value: string) => value, config.files).createFilter()
  const packageRoot = dirname(require.resolve('@sting8k/pi-vcc'))
  for (const file of readdirSync(packageRoot, { recursive: true }) as string[]) {
    const stat = statSync(join(packageRoot, file))
    if (!stat.isFile()) continue
    const runtime =
      file === 'package.json' || file === 'index.ts' || (file.startsWith(`src${sep}`) && file.endsWith('.ts'))
    expect(filter(join(root, 'node_modules/@sting8k/pi-vcc', file), stat), file).toBe(runtime)
  }
})

// Catches TS package loading failures, LLM fallback during compaction, and lost raw-history recall.
it.each([
  ['default', false, undefined],
  ['acceptEdits', false, undefined],
  ['default', true, undefined],
  ['default', false, 'Focus on the authentication decision']
] as const)(
  'compacts and recalls through Cherry policy (%s, disabled=%s, instructions=%s)',
  async (mode, disabled, instructions) => {
    const cwd = await mkdtemp(join(tmpdir(), 'cherry-pi-vcc-'))
    const configPath = join(cwd, 'pi-vcc-config.json')
    const previousConfigPath = process.env.PI_VCC_CONFIG_PATH
    const additionalExtensionPaths = [getPiVccExtensionPath(configPath)]
    let session: AgentSession | undefined
    let providerCalls = 0
    let recallCalls = 0
    let compacting = Boolean(instructions)
    let compactionRequest = ''
    const events: AgentSessionEvent[] = []
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const assistant = (
      content: AssistantMessage['content'],
      stopReason: AssistantMessage['stopReason'] = 'stop'
    ): AssistantMessage => ({
      role: 'assistant',
      content,
      stopReason,
      api: 'openai-completions',
      provider: 'fixture',
      model: 'fixture',
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    })
    modelRuntime.registerProvider('fixture', {
      api: 'openai-completions',
      baseUrl: 'https://unused.invalid',
      apiKey: 'fixture',
      models: [
        {
          id: 'fixture',
          name: 'fixture',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 100_000,
          maxTokens: 1_000
        }
      ],
      streamSimple: (_model, context) => {
        providerCalls++
        if (compacting) compactionRequest = JSON.stringify(context)
        const message = compacting
          ? assistant([{ type: 'text', text: 'Focused authentication summary.' }])
          : recallCalls++ === 0
            ? assistant(
                [
                  {
                    type: 'toolCall',
                    id: 'recall',
                    name: 'vcc_recall',
                    arguments: { query: 'original-history-marker', expand: [0] }
                  }
                ],
                'toolUse'
              )
            : assistant([{ type: 'text', text: 'Recalled the original history.' }])
        const stream = createAssistantMessageEventStream()
        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message })
        stream.end()
        return stream
      }
    })
    const settingsManager = SettingsManager.inMemory(
      { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1_000 } },
      { projectTrusted: true }
    )
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: cwd,
      settingsManager,
      additionalExtensionPaths,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        createPiApprovalExtension({
          sessionId: 'fixture',
          workspacePath: cwd,
          agentDataPath: cwd,
          additionalReadOnlyRoots: [],
          emit: () => {
            throw new Error('Session recall must not request approval')
          },
          getInteractionState: () => ({ userResponse: 'unavailable' }),
          getPermissionMode: () => mode,
          isDisabled: (name) => disabled && name === 'vcc_recall',
          autoApprovedTools: new Set(),
          approvalRequiredTools: new Set(),
          nonBypassableApprovalTools: new Set()
        })
      ]
    })
    try {
      await resourceLoader.reload()
      expect(resourceLoader.getExtensions().errors).toEqual([])
      for (const extension of resourceLoader.getExtensions().extensions) {
        expect(extension.commands.has('pi-vcc')).toBe(false)
        expect(extension.commands.has('pi-vcc-recall')).toBe(false)
      }
      expect(JSON.parse(await readFile(configPath, 'utf8')).overrideDefaultCompaction).toBe(true)
      const sessionManager = SessionManager.create(cwd, cwd)
      const original = `Fix authentication. ${'historical detail '.repeat(1_000)} original-history-marker`
      sessionManager.appendMessage({ role: 'user', content: original, timestamp: Date.now() })
      sessionManager.appendMessage(assistant([{ type: 'text', text: 'Authentication fixed.' }]))
      sessionManager.appendMessage({
        role: 'user',
        content: `Now check deployment. ${'current detail '.repeat(2_000)}`,
        timestamp: Date.now()
      })
      sessionManager.appendMessage(assistant([{ type: 'text', text: 'Deployment checked.' }]))
      const options = {
        cwd,
        agentDir: cwd,
        modelRuntime,
        model: modelRuntime.getModel('fixture', 'fixture'),
        settingsManager,
        resourceLoader
      }
      session = (await createAgentSession({ ...options, sessionManager })).session
      await session.bindExtensions({})
      const compaction = await session.compact(instructions)
      compacting = false
      expect(providerCalls).toBe(instructions ? 1 : 0)
      if (instructions) {
        expect(compactionRequest).toContain(instructions)
        expect(compaction.summary).toBe('Focused authentication summary.')
      }
      expect(compaction.summary.length).toBeLessThan(original.length)
      expect(compaction.summary).toContain('authentication')
      expect(compaction.summary).not.toContain('original-history-marker')
      const sessionFile = sessionManager.getSessionFile()!
      session.dispose()
      session = (await createAgentSession({ ...options, sessionManager: SessionManager.open(sessionFile) })).session
      await session.bindExtensions({})
      session.subscribe((event) => events.push(event))
      await session.prompt('Recall the original authentication request.')
      const recalled = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'vcc_recall')
      expect(JSON.stringify(recalled)).toContain(disabled ? 'disabled for this agent' : 'original-history-marker')
      expect(providerCalls).toBe(instructions ? 3 : 2)
      await mkdir('.context/cherry-electron-dev', { recursive: true })
      await writeFile(
        `.context/cherry-electron-dev/pi-vcc-${mode}-${disabled ? 'disabled' : instructions ? 'instructions' : 'default'}.json`,
        JSON.stringify({ compaction, recalled, providerCalls }, null, 2)
      )
    } finally {
      session?.dispose()
      if (previousConfigPath === undefined) delete process.env.PI_VCC_CONFIG_PATH
      else process.env.PI_VCC_CONFIG_PATH = previousConfigPath
      await rm(cwd, { recursive: true, force: true })
    }
  },
  30_000
)
