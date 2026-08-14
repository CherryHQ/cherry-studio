import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as FileUtils from '@main/utils/file'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const mocks = vi.hoisted(() => ({
  failSettingsWrite: false
}))

vi.mock('@main/utils/file', async () => {
  const actual = await vi.importActual<typeof FileUtils>('@main/utils/file')
  const nodePath = await import('node:path')
  return {
    ...actual,
    atomicWriteFile: async (...args: Parameters<typeof actual.atomicWriteFile>) => {
      if (
        mocks.failSettingsWrite &&
        nodePath.default.basename(args[0]) === 'settings.yaml' &&
        String(args[1]).includes('cherry-studio-codemate-481bd06fdd6c')
      ) {
        mocks.failSettingsWrite = false
        throw new Error('injected settings write failure')
      }
      return actual.atomicWriteFile(...args)
    }
  }
})

const {
  createDeepSeekHarnessDirectIdentity,
  resolveDeepSeekHarnessEndpoint,
  rollbackDeepSeekHarnessConfig,
  writeDeepSeekHarnessConfig
} = await import('../config')

const model = (partial: Partial<Model> = {}): Model =>
  ({
    id: 'anthropic::claude-sonnet',
    providerId: 'anthropic',
    apiModelId: 'claude-sonnet',
    name: 'Claude Sonnet',
    capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_RECOGNITION],
    inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    reasoning: { selectableEfforts: ['none', 'low', 'high', 'auto'] },
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    ...partial
  }) as Model

const provider = (partial: Partial<Provider> = {}): Provider =>
  ({
    id: 'anthropic',
    name: 'Anthropic',
    authType: 'api-key',
    apiKeys: [{ id: 'key', isEnabled: true }],
    isEnabled: true,
    apiFeatures: DEFAULT_API_FEATURES,
    settings: {},
    endpointConfigs: {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com/' },
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://proxy.example/' }
    },
    ...partial
  }) as Provider

const projection = () => ({
  ...createDeepSeekHarnessDirectIdentity('anthropic', 'anthropic-messages'),
  credentialValue: 'sk-sensitive',
  displayName: 'Cherry Studio: Anthropic',
  protocol: 'anthropic-messages' as const,
  baseUrl: 'https://api.anthropic.com',
  model: model(),
  modelId: 'claude-sonnet',
  agentPreset: 'code' as const
})

describe('DeepSeek Harness config transaction', () => {
  let dir: AbsoluteFilePath

  beforeEach(async () => {
    mocks.failSettingsWrite = false
    dir = (await mkdtemp(path.join(tmpdir(), 'deepseek-harness-config-'))) as AbsoluteFilePath
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('derives a stable route and credential marker from provider plus protocol', () => {
    expect(createDeepSeekHarnessDirectIdentity('anthropic', 'anthropic-messages')).toEqual({
      route: 'cherry-studio-codemate-481bd06fdd6c',
      credentialRef: 'CHERRY_STUDIO_CODEMATE_481BD06FDD6C_API_KEY'
    })
  })

  it('prefers a model endpoint and normalizes protocol-specific base URLs', () => {
    expect(
      resolveDeepSeekHarnessEndpoint(
        provider({
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
          apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: true },
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com/v1/' },
            [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://proxy.example/' }
          }
        }),
        model({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
      )
    ).toEqual({
      endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com'
    })

    expect(
      resolveDeepSeekHarnessEndpoint(
        provider({ apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: true } }),
        model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] })
      )
    ).toEqual({
      endpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      protocol: 'openai-responses',
      baseUrl: 'https://proxy.example/v1'
    })

    expect(() =>
      resolveDeepSeekHarnessEndpoint(provider(), model({ endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] }))
    ).toThrow('has no DeepSeek Harness compatible endpoint')
  })

  it('uses an advertised Anthropic route when the selected endpoint cannot preserve developer-role support', () => {
    const openAiFirstProvider = provider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: false },
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://proxy.example/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://proxy.example/anthropic' }
      }
    })
    const openAiFirstModel = model({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })

    expect(resolveDeepSeekHarnessEndpoint(openAiFirstProvider, openAiFirstModel)).toEqual({
      endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      protocol: 'anthropic-messages',
      baseUrl: 'https://proxy.example/anthropic'
    })

    expect(
      resolveDeepSeekHarnessEndpoint(
        { ...openAiFirstProvider, apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: true } },
        openAiFirstModel
      )
    ).toEqual({
      endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      protocol: 'openai-completions',
      baseUrl: 'https://proxy.example/v1'
    })

    expect(
      resolveDeepSeekHarnessEndpoint(
        {
          ...openAiFirstProvider,
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://proxy.example/v1' },
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://proxy.example/anthropic' }
          }
        },
        model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
      )
    ).toEqual({
      endpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      protocol: 'anthropic-messages',
      baseUrl: 'https://proxy.example/anthropic'
    })
  })

  it('rejects direct endpoints whose developer-role limitation cannot be represented by DSH', () => {
    const providerWithoutDeveloperRole = provider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: false },
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://proxy.example/v1' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://proxy.example/v1' }
      }
    })

    expect(() =>
      resolveDeepSeekHarnessEndpoint(
        providerWithoutDeveloperRole,
        model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] })
      )
    ).toThrow('must be used through the Unified Gateway')
    expect(() =>
      resolveDeepSeekHarnessEndpoint(
        providerWithoutDeveloperRole,
        model({ reasoning: undefined, endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES] })
      )
    ).toThrow('must be used through the Unified Gateway')
    expect(() =>
      resolveDeepSeekHarnessEndpoint(
        { ...providerWithoutDeveloperRole, defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
        model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })
      )
    ).toThrow('must be used through the Unified Gateway')

    expect(
      resolveDeepSeekHarnessEndpoint(
        { ...providerWithoutDeveloperRole, defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS },
        model({
          reasoning: undefined,
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        })
      )
    ).toMatchObject({ endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })
  })

  it('uses pi-ai DeepSeek compatibility for reasoning models on the official chat endpoint', () => {
    expect(
      resolveDeepSeekHarnessEndpoint(
        provider({
          id: 'deepseek',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          apiFeatures: { ...DEFAULT_API_FEATURES, developerRole: false },
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com' }
          }
        }),
        model({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })
      )
    ).toEqual({
      endpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      protocol: 'openai-completions',
      baseUrl: 'https://api.deepseek.com/v1'
    })
  })

  it('preserves comments, unrelated routes, and old managed models while selecting the new default', async () => {
    const identity = createDeepSeekHarnessDirectIdentity('anthropic', 'anthropic-messages')
    await writeFile(path.join(dir, '.credentials.yaml'), '# credentials note\nOTHER_KEY: keep\n', { mode: 0o600 })
    await writeFile(
      path.join(dir, 'settings.yaml'),
      `# settings note\nunrelated:\n  keep: true\nllm-pi-ai:\n  providers:\n    foreign-route:\n      apiKeyEnv: FOREIGN_KEY\n    ${identity.route}:\n      apiKeyEnv: ${identity.credentialRef}\n      headers:\n        Authorization: Bearer old-secret\n      models:\n        - id: old-model\n          name: Old model\nagent-default-model:\n  provider: old\n  model: old-model\n  reasoningEffort: high\n`,
      { mode: 0o600 }
    )

    await writeDeepSeekHarnessConfig(dir, projection())

    const credentialsText = await readFile(path.join(dir, '.credentials.yaml'), 'utf8')
    const settingsText = await readFile(path.join(dir, 'settings.yaml'), 'utf8')
    const settings = parse(settingsText)
    expect(credentialsText).toContain('# credentials note')
    expect(credentialsText).toContain('OTHER_KEY: keep')
    expect(settingsText).toContain('# settings note')
    expect(settings.unrelated).toEqual({ keep: true })
    expect(settings['llm-pi-ai'].providers['foreign-route']).toEqual({ apiKeyEnv: 'FOREIGN_KEY' })
    expect(settings['llm-pi-ai'].providers[identity.route].headers).toBeUndefined()
    expect(settings['llm-pi-ai'].providers[identity.route].models.map((item: { id: string }) => item.id)).toEqual([
      'old-model',
      'claude-sonnet'
    ])
    expect(settings['llm-pi-ai'].providers[identity.route].models[1]).toMatchObject({
      contextWindow: 200_000,
      maxTokens: 8192,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'high' }
    })
    expect(settings['agent-default-model']).toEqual({ provider: identity.route, model: 'claude-sonnet' })
    expect(settings['agent-presets']).toEqual({ default: 'code' })
  })

  it('preserves sibling credential entries without validating their names or values', async () => {
    const identity = createDeepSeekHarnessDirectIdentity('anthropic', 'anthropic-messages')
    await writeFile(path.join(dir, '.credentials.yaml'), 'external-key: value\ncount: 5\n', { mode: 0o600 })

    await writeDeepSeekHarnessConfig(dir, projection())

    expect(parse(await readFile(path.join(dir, '.credentials.yaml'), 'utf8'))).toEqual({
      'external-key': 'value',
      count: 5,
      [identity.credentialRef]: 'sk-sensitive'
    })
  })

  it('rejects an invalid managed credential reference', async () => {
    await expect(
      writeDeepSeekHarnessConfig(dir, { ...projection(), credentialRef: 'invalid-reference' })
    ).rejects.toThrow('DeepSeek Harness credential reference "invalid-reference" is invalid')
  })

  it('keeps the shared Harness preset unchanged when CodeMate is set to inherit it', async () => {
    await writeFile(path.join(dir, 'settings.yaml'), 'agent-presets:\n  # chosen in DSH\n  default: custom-preset\n', {
      mode: 0o600
    })

    await writeDeepSeekHarnessConfig(dir, { ...projection(), agentPreset: 'inherit' })

    const settingsText = await readFile(path.join(dir, 'settings.yaml'), 'utf8')
    expect(settingsText).toContain('# chosen in DSH')
    expect(parse(settingsText)['agent-presets']).toEqual({ default: 'custom-preset' })
  })

  it('creates a private Harness directory and private config files', async () => {
    const configDir = path.join(dir, 'fresh') as AbsoluteFilePath
    await writeDeepSeekHarnessConfig(configDir, projection())
    if (process.platform === 'win32') return

    expect((await stat(configDir)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(configDir, '.credentials.yaml'))).mode & 0o777).toBe(0o600)
    expect((await stat(path.join(configDir, 'settings.yaml'))).mode & 0o777).toBe(0o600)
  })

  it('writes a DSH-compatible non-reasoning marker instead of an invalid off-only effort map', async () => {
    const nonReasoningProjection = {
      ...projection(),
      model: model({ reasoning: { selectableEfforts: ['none'] } })
    }
    await writeDeepSeekHarnessConfig(dir, nonReasoningProjection)

    const settings = parse(await readFile(path.join(dir, 'settings.yaml'), 'utf8'))
    expect(settings['llm-pi-ai'].providers[nonReasoningProjection.route].models[0].reasoningEfforts).toBe(false)
  })

  it('refuses to overwrite a deterministic route without the CodeMate credential marker', async () => {
    const identity = createDeepSeekHarnessDirectIdentity('anthropic', 'anthropic-messages')
    const original = `llm-pi-ai:\n  providers:\n    ${identity.route}:\n      apiKeyEnv: USER_OWNED_KEY\n`
    await writeFile(path.join(dir, 'settings.yaml'), original, { mode: 0o600 })

    await expect(writeDeepSeekHarnessConfig(dir, projection())).rejects.toThrow('is not owned by CodeMate')
    expect(await readFile(path.join(dir, 'settings.yaml'), 'utf8')).toBe(original)
  })

  it('does not expose existing credential contents through YAML diagnostics', async () => {
    await writeFile(path.join(dir, '.credentials.yaml'), 'BROKEN: "sk-existing-secret\n', { mode: 0o600 })

    const write = writeDeepSeekHarnessConfig(dir, projection())
    await expect(write).rejects.toThrow('Invalid DeepSeek Harness YAML')
    await expect(write).rejects.not.toThrow('sk-existing-secret')
  })

  it('rolls back the credential file when the settings replacement fails', async () => {
    const credentialsPath = path.join(dir, '.credentials.yaml')
    const settingsPath = path.join(dir, 'settings.yaml')
    await writeFile(credentialsPath, 'ORIGINAL_KEY: original\n', { mode: 0o600 })
    await writeFile(settingsPath, 'unrelated: original\n', { mode: 0o600 })
    mocks.failSettingsWrite = true

    await expect(writeDeepSeekHarnessConfig(dir, projection())).rejects.toThrow('injected settings write failure')
    expect(await readFile(credentialsPath, 'utf8')).toBe('ORIGINAL_KEY: original\n')
    expect(await readFile(settingsPath, 'utf8')).toBe('unrelated: original\n')
  })

  it('rolls back a completed write only while both files still match its bytes', async () => {
    const settingsPath = path.join(dir, 'settings.yaml')
    const receipt = await writeDeepSeekHarnessConfig(dir, projection())
    expect(await rollbackDeepSeekHarnessConfig(receipt)).toBe(true)
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const concurrentReceipt = await writeDeepSeekHarnessConfig(dir, projection())
    await writeFile(settingsPath, `${concurrentReceipt.settings.written}# user edit\n`, { mode: 0o600 })
    expect(await rollbackDeepSeekHarnessConfig(concurrentReceipt)).toBe(false)
    expect(await readFile(settingsPath, 'utf8')).toContain('# user edit')
  })

  it('waits for a sibling lock without deleting it', async () => {
    const lockPath = path.join(dir, '.credentials.yaml.lock')
    await writeFile(lockPath, 'external owner', { mode: 0o600 })
    const pendingWrite = writeDeepSeekHarnessConfig(dir, projection())
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(await readFile(lockPath, 'utf8')).toBe('external owner')
    await unlink(lockPath)
    await expect(pendingWrite).resolves.toBeDefined()
  })

  it('reclaims a managed lock after its owner process has exited', async () => {
    const lockPath = path.join(dir, '.credentials.yaml.lock')
    await writeFile(lockPath, JSON.stringify({ version: 1, pid: 424242, token: 'orphaned-owner' }), { mode: 0o600 })
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 424242 && signal === 0) {
        throw Object.assign(new Error('process not found'), { code: 'ESRCH' })
      }
      return true
    }) as typeof process.kill)

    await expect(writeDeepSeekHarnessConfig(dir, projection())).resolves.toBeDefined()
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
