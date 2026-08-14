import path from 'node:path'

import { MODALITY } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { DEFAULT_API_FEATURES, type Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@data/services/ProviderService', () => ({ providerService: {} }))
vi.mock('@data/services/ModelService', () => ({ modelService: {} }))

import { buildDshCompositionYaml, type DshCompositionInput } from '../compositionBuilder'
import { buildDshProviderInjection } from '../modelInjection'

const SECRET_API_KEY = 'sk-cherry-super-secret-key'

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
  it('mounts the token meter and projection registry for context usage', () => {
    const yaml = buildDshCompositionYaml(makeInput())
    expect(yaml).toContain('dsh-token-meter')
    expect(yaml).toContain('dsh-session-projection')
  })

  it('mounts auto-compaction and the tool-result pruner', () => {
    const yaml = buildDshCompositionYaml(makeInput())
    expect(yaml).toContain('dsh-compaction-basic')
    expect(yaml).toContain('dsh-compaction-tool-result-pruner')
  })

  it('mounts the command registry and the full goal stack including the round driver', () => {
    const yaml = buildDshCompositionYaml(makeInput())
    expect(yaml).toContain('dsh-commands')
    expect(yaml).toContain('dsh-command-compact')
    expect(yaml).toContain('dsh-command-goal')
    expect(yaml).toContain('dsh-tool-goal')
    expect(yaml).toContain('dsh-goal-round-driver')
  })

  it('mounts enabled skill dirs as the only skill roots, disabled otherwise', () => {
    const withSkills = buildDshCompositionYaml(
      makeInput({ skillDirs: ['/data/Skills/pdf-tools', '/data/Skills/review'] })
    )
    expect(withSkills).toContain('enabled: true')
    expect(withSkills).toContain('includeDefaultRoots: false')
    expect(withSkills).toContain('- "/data/Skills/pdf-tools"')
    expect(withSkills).toContain('- "/data/Skills/review"')

    const without = buildDshCompositionYaml(makeInput())
    expect(without).not.toContain('includeDefaultRoots')
    expect(without).toMatch(/skills:\n\s+enabled: false/)
  })

  it('breaks {{ openers in the persona so dsh strict interpolation cannot throw', () => {
    const yml = buildDshCompositionYaml(makeInput({ persona: 'Use {{secret}} and {{cwd}} literally.' }))
    expect(yml).not.toContain('{{')
    expect(yml).toContain('{ {secret}')
  })

  it('drops the dsh identity sentence only for a custom base', () => {
    expect(buildDshCompositionYaml(makeInput({ customBase: true }))).toContain('includeHarnessIdentity: false')
    expect(buildDshCompositionYaml(makeInput())).not.toContain('includeHarnessIdentity')
  })

  it('never contains the API key — the only credential reference is the env indirection', () => {
    const yml = buildDshCompositionYaml(makeInput())

    expect(yml).not.toContain(SECRET_API_KEY)
    expect(yml).toContain('apiKeyEnv: "CHERRY_DSH_API_KEY"')
    // No literal apiKey scalar anywhere — only the env-name indirection.
    expect(yml).not.toMatch(/^\s*apiKey:/m)
  })

  it('always composes user-approval with policy ask, bypass included', () => {
    for (const permissionMode of ['default', 'acceptEdits', 'bypassPermissions'] as const) {
      expect(buildDshCompositionYaml(makeInput({ permissionMode }))).toContain('policy: "ask"')
    }
  })

  it('maps sandbox mode per permission mode', () => {
    expect(buildDshCompositionYaml(makeInput({ permissionMode: 'default' }))).toContain('mode: "workspace-write"')
    expect(buildDshCompositionYaml(makeInput({ permissionMode: 'acceptEdits' }))).toContain('mode: "workspace-write"')
    expect(buildDshCompositionYaml(makeInput({ permissionMode: 'bypassPermissions' }))).toContain(
      'mode: "danger-full-access"'
    )
  })

  it('uses the official sandboxed pwsh stack on Windows', () => {
    const yaml = buildDshCompositionYaml(
      makeInput({ platform: 'win32', workspacePath: 'C:\\Users\\Cherry\\workspace' })
    )

    expect(yaml).toContain('dsh-pwsh-sandbox')
    expect(yaml).toContain('dsh-tool-pwsh')
    expect(yaml).toContain('dsh-shell-env')
    expect(yaml).not.toContain('dsh-bash-sandbox')
    expect(yaml).toContain('dsh-sandbox-local')
    expect(yaml).toContain('dsh-sandbox-policy')
    expect(yaml).toContain('toolBash: false')
    expect(yaml).toContain('workspaceRoot: "C:\\\\Users\\\\Cherry\\\\workspace"')
    expect(yaml).toContain('cwd: "C:\\\\Users\\\\Cherry\\\\workspace"')
  })

  it('resolves every plugin specifier to an absolute on-disk path', () => {
    const yml = buildDshCompositionYaml(makeInput())
    const specifiers = [...yml.matchAll(/^ {2}name: (".*")$/gm)].map(([, quoted]) => JSON.parse(quoted) as string)

    expect(specifiers).toHaveLength(25)
    for (const specifier of specifiers) {
      expect(path.isAbsolute(specifier), `not absolute: ${specifier}`).toBe(true)
    }
    expect(specifiers.at(-1)).toContain('dsh-bridge')
  })

  it('mounts the retry executor so a failed provider request is retried', () => {
    expect(buildDshCompositionYaml(makeInput())).toContain('- id: llm-retry')
  })

  it('inlines the provider route and model declaration', () => {
    const yml = buildDshCompositionYaml(makeInput())
    expect(yml).toContain('"deepseek":')
    expect(yml).toContain('api: "openai-completions"')
    expect(yml).toContain('baseURL: "https://api.deepseek.com/v1"')
    expect(yml).toContain('"X-Trace": "on"')
    expect(yml).toContain('- id: "deepseek-chat"')
    expect(yml).toContain('contextWindow: 128000')
    expect(yml).toContain('maxTokens: 4096')
    expect(yml).toMatch(/input:\n\s+- "text"/)
    expect(yml).toContain('root: "/tmp/dsh-sessions"')
    expect(yml).toContain('workspaceRoot: "/tmp/dsh-workspace"')
  })

  it('mounts durable image attachments before tool-fs', () => {
    const yml = buildDshCompositionYaml(makeInput())
    const attachmentIndex = yml.indexOf('@deepseek-ai/dsh-attachment-local')
    const toolFsIndex = yml.indexOf('@deepseek-ai/dsh-tool-fs')

    expect(attachmentIndex).toBeGreaterThan(0)
    expect(attachmentIndex).toBeLessThan(toolFsIndex)
    expect(yml).toContain('dshHome: "/tmp/dsh-root"')
  })

  it('declares image input only for Cherry vision models', () => {
    const vision = makeInjection({ capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION] })
    const visionYml = buildDshCompositionYaml(makeInput({ modelConfig: vision.modelConfig }))
    expect(visionYml).toMatch(/input:\n\s+- "text"\n\s+- "image"/)

    const audio = makeInjection({ inputModalities: [MODALITY.TEXT, MODALITY.AUDIO] })
    const audioYml = buildDshCompositionYaml(makeInput({ modelConfig: audio.modelConfig }))
    expect(audioYml).toMatch(/input:\n\s+- "text"/)
    expect(audioYml).not.toContain('- "audio"')
  })

  it('uses the same Anthropic preference as the shared filter for dual-protocol models', () => {
    const provider = {
      id: 'dual',
      name: 'Dual',
      apiFeatures: DEFAULT_API_FEATURES,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai', baseUrl: 'https://openai.example' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://anthropic.example' }
      }
    } as unknown as Provider
    const model = {
      id: 'dual::model',
      providerId: 'dual',
      apiModelId: 'model',
      name: 'Dual model',
      capabilities: [],
      contextWindow: 128_000,
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    } as unknown as Model

    const injection = buildDshProviderInjection(provider, model, SECRET_API_KEY)

    expect(injection.api).toBe('anthropic-messages')
    expect(injection.baseUrl).toBe('https://anthropic.example')
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
      expect(injection.usageCapture.providerId).toBe(providerId)
      expect(injection.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
      expect(yaml).toContain('"google":')
      expect(yaml).not.toContain('api: "google-generative-ai"')
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
    expect(yaml).toContain('        reasoning: "high"')
    expect(yaml).toMatch(/reasoningEfforts:\n\s+low: "low"\n\s+high: "high"/)
  })

  it('preserves provider-default reasoning when Cherry selects Default', () => {
    const injection = makeInjection({
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { selectableEfforts: ['low', 'high'] }
    })
    const yaml = buildDshCompositionYaml(makeInput({ modelConfig: injection.modelConfig }))

    expect(injection.reasoning).toBeUndefined()
    expect(yaml).not.toMatch(/^ {8}reasoning:/m)
    expect(yaml).toContain('reasoningEfforts:')
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
    expect(yaml).toContain('        reasoning: "off"')
    expect(yaml).toMatch(/reasoningEfforts:\n\s+high: "high"\n\s+off:/)
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
    expect(yaml).toContain('reasoningEfforts: false')
  })

  it('rejects models that explicitly declare no text input', () => {
    expect(() => makeInjection({ inputModalities: [MODALITY.AUDIO] })).toThrow('text input is required')
  })
})
