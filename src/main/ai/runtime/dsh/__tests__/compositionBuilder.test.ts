import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODALITY } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

vi.mock('@data/services/ProviderService', () => ({ providerService: {} }))
vi.mock('@data/services/ModelService', () => ({ modelService: {} }))

import { buildDshCompositionYaml, type DshCompositionInput, toDshPluginUrl } from '../compositionBuilder'
import { buildDshProviderInjection } from '../modelInjection'

const SECRET_API_KEY = 'sk-cherry-super-secret-key'

interface ParsedEntry {
  id: string
  name: string
  config?: Record<string, any>
}

/** Parse the emitted composition back — assertions are structural, not quoting-coupled. */
function parseEntries(yml: string): ParsedEntry[] {
  return parse(yml) as ParsedEntry[]
}

function entryById(yml: string, id: string): ParsedEntry {
  const entry = parseEntries(yml).find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`composition has no entry "${id}"`)
  return entry
}

function providerRoute(yml: string, providerName: string): Record<string, any> {
  return entryById(yml, 'llm').config?.providers?.[providerName]
}

function makeInjection(modelOverrides: Partial<Model> = {}, reasoningEffort: ReasoningEffortOption = 'default') {
  const provider = {
    id: 'deepseek',
    name: 'DeepSeek',
    apiFeatures: DEFAULT_API_FEATURES,
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: {
      'openai-chat-completions': { adapterFamily: 'openai', baseUrl: 'https://api.deepseek.com' }
    },
    settings: { extraHeaders: { 'X-Trace': 'on' } }
  } as unknown as Provider
  const model = {
    id: 'deepseek::deepseek-chat',
    providerId: 'deepseek',
    apiModelId: 'deepseek-chat',
    name: 'DeepSeek Chat',
    capabilities: [],
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    ...modelOverrides
  } as unknown as Model
  return buildDshProviderInjection(provider, model, SECRET_API_KEY, undefined, reasoningEffort)
}

function makeInput(overrides: Partial<DshCompositionInput> = {}): DshCompositionInput {
  const injection = makeInjection()
  return {
    providerName: injection.providerName,
    api: injection.api,
    baseUrl: injection.baseUrl,
    ...(injection.headers ? { headers: injection.headers } : {}),
    ...(injection.reasoning ? { reasoning: injection.reasoning } : {}),
    modelConfig: injection.modelConfig,
    workspacePath: '/tmp/dsh-workspace',
    dshRoot: '/tmp/dsh-root',
    sessionsRoot: '/tmp/dsh-sessions',
    permissionMode: 'default',
    persona: 'You are a Cherry agent.\n\nBe helpful.',
    customBase: false,
    skillDirs: [],
    ...overrides
  }
}

describe('buildDshCompositionYaml', () => {
  it('emits parseable YAML whose entries all carry an id and a plugin name', () => {
    const entries = parseEntries(buildDshCompositionYaml(makeInput()))
    expect(entries.length).toBeGreaterThan(10)
    for (const entry of entries) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.name).toBe('string')
    }
  })

  it('mounts enabled skill dirs as the only skill roots, disabled otherwise', () => {
    const withSkills = buildDshCompositionYaml(
      makeInput({ skillDirs: ['/data/Skills/pdf-tools', '/data/Skills/review'] })
    )
    expect(entryById(withSkills, 'agent-spine').config?.skills).toEqual({
      enabled: true,
      filesystem: {
        includeDefaultRoots: false,
        customSkillDirs: ['/data/Skills/pdf-tools', '/data/Skills/review'],
        watch: false
      }
    })

    const without = buildDshCompositionYaml(makeInput())
    expect(entryById(without, 'agent-spine').config?.skills).toEqual({ enabled: false })
  })

  it('breaks {{ openers in the persona so dsh strict interpolation cannot throw', () => {
    const yml = buildDshCompositionYaml(makeInput({ persona: 'Use {{secret}} and {{cwd}} literally.' }))
    expect(yml).not.toContain('{{')
    expect(entryById(yml, 'agent-spine').config?.persona).toBe('Use { {secret}} and { {cwd}} literally.')
  })

  it('drops the dsh identity sentence only for a custom base', () => {
    const custom = entryById(buildDshCompositionYaml(makeInput({ customBase: true })), 'agent-spine')
    expect(custom.config?.includeHarnessIdentity).toBe(false)
    const native = entryById(buildDshCompositionYaml(makeInput()), 'agent-spine')
    expect(native.config).not.toHaveProperty('includeHarnessIdentity')
  })

  it('never contains the API key — the only credential reference is the env indirection', () => {
    const yml = buildDshCompositionYaml(makeInput())

    expect(yml).not.toContain(SECRET_API_KEY)
    const route = providerRoute(yml, 'deepseek')
    expect(route.apiKeyEnv).toBe('CHERRY_DSH_API_KEY')
    expect(route).not.toHaveProperty('apiKey')
  })

  it('always composes user-approval with policy ask, bypass included', () => {
    for (const permissionMode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      const yml = buildDshCompositionYaml(makeInput({ permissionMode }))
      expect(entryById(yml, 'approval').config?.policy).toBe('ask')
    }
  })

  it('maps sandbox mode per permission mode', () => {
    const modeFor = (permissionMode: DshCompositionInput['permissionMode']) =>
      entryById(buildDshCompositionYaml(makeInput({ permissionMode })), 'sandbox-policy').config?.mode
    expect(modeFor('default')).toBe('workspace-write')
    expect(modeFor('acceptEdits')).toBe('workspace-write')
    expect(modeFor('bypassPermissions')).toBe('danger-full-access')
  })

  it('uses the official sandboxed pwsh stack on Windows', () => {
    const yml = buildDshCompositionYaml(makeInput({ platform: 'win32', workspacePath: 'C:\\Users\\Cherry\\workspace' }))
    const entries = parseEntries(yml)
    const names = entries.map((entry) => entry.name).join('\n')

    expect(names).toContain('dsh-pwsh-sandbox')
    expect(names).toContain('dsh-tool-pwsh')
    expect(names).toContain('dsh-shell-env')
    expect(names).not.toContain('dsh-bash-sandbox')
    expect(names).toContain('dsh-sandbox-local')
    expect(names).toContain('dsh-sandbox-policy')
    expect(entryById(yml, 'agent-spine').config?.toolBash).toBe(false)
    expect(entryById(yml, 'sandbox-policy').config?.workspaceRoot).toBe('C:\\Users\\Cherry\\workspace')
    expect(entryById(yml, 'shell-executor').config?.cwd).toBe('C:\\Users\\Cherry\\workspace')
  })

  it('emits every plugin entry as an importable on-disk file URL', () => {
    const entries = parseEntries(buildDshCompositionYaml(makeInput()))

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(new URL(entry.name).protocol).toBe('file:')
      expect(path.isAbsolute(fileURLToPath(entry.name)), `not absolute: ${entry.name}`).toBe(true)
    }
  })

  it('converts Windows drive paths to ESM-compatible file URLs', () => {
    const pluginPath = 'C:\\Users\\xxx\\Code\\cherry-studio\\node_modules\\@deepseek-ai\\dsh-tool-pwsh\\lib\\index.js'
    const pluginUrl = toDshPluginUrl(pluginPath, true)

    expect(pluginUrl).toBe(
      'file:///C:/Users/xxx/Code/cherry-studio/node_modules/@deepseek-ai/dsh-tool-pwsh/lib/index.js'
    )
    expect(fileURLToPath(pluginUrl, { windows: true })).toBe(pluginPath)
  })

  it('inlines the provider route and model declaration', () => {
    const yml = buildDshCompositionYaml(makeInput())
    const route = providerRoute(yml, 'deepseek')

    expect(route.api).toBe('openai-completions')
    expect(route.baseURL).toBe('https://api.deepseek.com/v1')
    expect(route.headers).toEqual({ 'X-Trace': 'on' })
    expect(route.models).toEqual([
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        contextWindow: 128_000,
        maxTokens: 4_096,
        input: ['text'],
        reasoningEfforts: false
      }
    ])
    expect(entryById(yml, 'sessions').config?.root).toBe('/tmp/dsh-sessions')
    expect(entryById(yml, 'sandbox-policy').config?.workspaceRoot).toBe('/tmp/dsh-workspace')
  })

  it('mounts the dsh-factory subagent split: continuable spawn, one-shot foreground fork', () => {
    const yml = buildDshCompositionYaml(makeInput())
    const ids = parseEntries(yml).map((entry) => entry.id)
    for (const id of [
      'subagent',
      'subagent-spawn',
      'subagent-fork',
      'tool-subagent-control',
      'tool-subagent-list-agents',
      'tool-subagent-report'
    ]) {
      expect(ids).toContain(id)
    }

    expect(entryById(yml, 'subagent-spawn').config).toEqual({ providerName: 'spawn' })
    expect(entryById(yml, 'subagent-fork').config).toEqual({ providerName: 'fork' })
    expect(entryById(yml, 'tool-subagent').config).toMatchObject({
      provider: 'spawn',
      toolName: 'subagent',
      backgroundMode: 'continuable'
    })
    const fork = entryById(yml, 'tool-subagent-fork').config
    expect(fork).toMatchObject({ provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'one-shot' })
    // No jobs plane is mounted, so background one-shot MUST stay unreachable.
    expect(fork?.enableRunInBackground).toBe(false)
    // Children must never see the plan-exit tool (their asks cannot reach a human).
    expect(entryById(yml, 'tool-subagent').config?.toolFilter).toEqual({ deny: ['exit_plan_mode'] })
    expect(fork?.toolFilter).toEqual({ deny: ['exit_plan_mode'] })
  })

  it('mounts user-questions and plan-mode with a non-empty guidance section', () => {
    const yml = buildDshCompositionYaml(makeInput())
    expect(entryById(yml, 'user-questions')).not.toHaveProperty('config')
    const section = entryById(yml, 'plan-mode').config?.section
    expect(typeof section).toBe('string')
    // The section is the only plan guidance the model gets; it must name the exit tool.
    expect(section).toContain('exit_plan_mode')
    expect(section).not.toContain('ask_user_question')
  })

  it('mounts durable image attachments before tool-fs', () => {
    const yml = buildDshCompositionYaml(makeInput())
    const ids = parseEntries(yml).map((entry) => entry.id)

    expect(ids.indexOf('attachments')).toBeGreaterThan(0)
    expect(ids.indexOf('attachments')).toBeLessThan(ids.indexOf('tool-fs'))
    expect(entryById(yml, 'attachments').config?.dshHome).toBe('/tmp/dsh-root')
  })

  it('declares image input only for Cherry vision models', () => {
    const vision = makeInjection({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION] })
    const visionYml = buildDshCompositionYaml(makeInput({ modelConfig: vision.modelConfig }))
    expect(providerRoute(visionYml, 'deepseek').models[0].input).toEqual(['text', 'image'])

    const audio = makeInjection({ inputModalities: [MODALITY.TEXT, MODALITY.AUDIO] })
    const audioYml = buildDshCompositionYaml(makeInput({ modelConfig: audio.modelConfig }))
    expect(providerRoute(audioYml, 'deepseek').models[0].input).toEqual(['text'])
  })

  it("honors Google as CherryIN's first declared route when the model supports multiple protocols", () => {
    const provider = {
      id: 'cherryin',
      name: 'CherryIN',
      apiFeatures: DEFAULT_API_FEATURES,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          adapterFamily: 'cherryin',
          baseUrl: 'https://open.cherryin.net'
        },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'cherryin',
          baseUrl: 'https://open.cherryin.net'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          adapterFamily: 'cherryin',
          baseUrl: 'https://open.cherryin.net'
        }
      }
    } as unknown as Provider
    const model = {
      id: 'cherryin::google/gemini-3.6-flash',
      providerId: 'cherryin',
      apiModelId: 'google/gemini-3.6-flash',
      name: 'Google: Gemini 3.6 Flash',
      capabilities: [],
      contextWindow: 1_048_576,
      endpointTypes: [
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ]
    } as unknown as Model

    const injection = buildDshProviderInjection(provider, model, SECRET_API_KEY)

    expect(injection.api).toBe('google-generative-ai')
    expect(injection.providerName).toBe('google')
    expect(injection.baseUrl).toBe('https://open.cherryin.net/v1beta')
  })

  it.each(['gemini', 'cherryin', 'aihubmix', 'dmxapi'])(
    "reuses pi-ai's Google catalog provider for %s without an unsupported explicit api override",
    (providerId) => {
      const provider = {
        id: providerId,
        name: providerId,
        apiFeatures: DEFAULT_API_FEATURES,
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            adapterFamily: 'google',
            baseUrl: 'https://generativelanguage.googleapis.com'
          }
        }
      } as unknown as Provider
      const model = {
        id: `${providerId}::gemini-2.5-pro`,
        providerId,
        apiModelId: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        capabilities: [],
        contextWindow: 1_000_000,
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      } as unknown as Model
      const injection = buildDshProviderInjection(provider, model, SECRET_API_KEY)
      const yaml = buildDshCompositionYaml(
        makeInput({
          providerName: injection.providerName,
          api: injection.api,
          baseUrl: injection.baseUrl,
          modelConfig: injection.modelConfig
        })
      )

      expect(injection.providerName).toBe('google')
      expect(injection.usageCapture).toMatchObject({ owner: 'agent-sdk', providerId })
      expect(injection.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
      const route = providerRoute(yaml, 'google')
      expect(route).toBeDefined()
      // Google is a catalog-provider reuse: an explicit api would be rejected by rc.6.
      expect(route).not.toHaveProperty('api')
    }
  )

  it('declares reasoning capabilities and freezes an explicit effort in the provider profile', () => {
    const injection = makeInjection(
      {
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: { selectableEfforts: ['none', 'low', 'high'] }
      },
      'high'
    )
    const yaml = buildDshCompositionYaml(
      makeInput({ reasoning: injection.reasoning, modelConfig: injection.modelConfig })
    )

    expect(injection.reasoning).toBe('high')
    expect(injection.modelConfig.reasoningEfforts).toEqual({ low: 'low', high: 'high' })
    const route = providerRoute(yaml, 'deepseek')
    expect(route.reasoning).toBe('high')
    expect(route.models[0].reasoningEfforts).toEqual({ low: 'low', high: 'high' })
  })

  it('preserves provider-default reasoning when Cherry selects Default', () => {
    const injection = makeInjection({
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { selectableEfforts: ['low', 'high'] }
    })
    const yaml = buildDshCompositionYaml(makeInput({ modelConfig: injection.modelConfig }))

    expect(injection.reasoning).toBeUndefined()
    const route = providerRoute(yaml, 'deepseek')
    expect(route).not.toHaveProperty('reasoning')
    expect(route.models[0].reasoningEfforts).toEqual({ low: 'low', high: 'high' })
  })

  it('maps explicit None to dsh Off without changing the default path', () => {
    const injection = makeInjection(
      {
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: { selectableEfforts: ['none', 'auto'], defaultEffort: 'high' }
      },
      'none'
    )
    const yaml = buildDshCompositionYaml(
      makeInput({ reasoning: injection.reasoning, modelConfig: injection.modelConfig })
    )

    expect(injection.reasoning).toBe('off')
    const route = providerRoute(yaml, 'deepseek')
    expect(route.reasoning).toBe('off')
    // `off: null` = declared-with-no-value: dsh offers Off and sends nothing on the wire.
    expect(route.models[0].reasoningEfforts).toEqual({ high: 'high', off: null })
  })

  it('maps a toggle-only Auto selection to the model default effort', () => {
    const injection = makeInjection(
      {
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: { selectableEfforts: ['none', 'auto'], defaultEffort: 'high' }
      },
      'auto'
    )

    expect(injection.reasoning).toBe('high')
    expect(injection.modelConfig.reasoningEfforts).toEqual({ high: 'high' })
  })

  it('marks non-reasoning hand-declared models explicitly', () => {
    const injection = makeInjection()
    const yaml = buildDshCompositionYaml(makeInput({ modelConfig: injection.modelConfig }))

    expect(injection.modelConfig.reasoningEfforts).toBe(false)
    expect(providerRoute(yaml, 'deepseek').models[0].reasoningEfforts).toBe(false)
  })

  it('rejects models that explicitly declare no text input', () => {
    expect(() => makeInjection({ inputModalities: [MODALITY.AUDIO] })).toThrow('text input is required')
  })
})
