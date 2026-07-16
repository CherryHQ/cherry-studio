import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getAuthConfig: vi.fn(),
  getByProviderId: vi.fn(),
  getByKey: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getApiKeys: mocks.getApiKeys,
    getRotatedApiKey: mocks.getRotatedApiKey,
    getAuthConfig: mocks.getAuthConfig,
    getByProviderId: mocks.getByProviderId
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getByKey } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { buildAiSdkAgentParams, DEFAULT_AI_SDK_AGENT_MAX_TURNS } = await import('./buildAiSdkAgentParams')
const { AiSdkAgentMissingApiKeyError, AiSdkAgentUnsupportedModelError, resolveAndAssertAiSdkAgentModel } = await import(
  './validateModel'
)

function makeAgentProvider(overrides: Parameters<typeof makeProvider>[0] = {}) {
  return makeProvider({
    id: 'openai',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    ...overrides
  })
}

function makeAgentModel(overrides: Parameters<typeof makeModel>[0] = {}) {
  return makeModel({
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
    ...overrides
  })
}

let workspace: string

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.getApiKeys.mockReturnValue([{ id: 'k1', key: 'sk-test', isEnabled: true }])
  mocks.getRotatedApiKey.mockReturnValue('sk-test')
  mocks.getAuthConfig.mockReturnValue(null)
  workspace = await mkdtemp(path.join(os.tmpdir(), 'aisdk-agent-params-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    agent: { id: 'agent-1', instructions: 'Be terse.', configuration: {} },
    sessionId: 'session-1',
    workspacePath: workspace,
    provider: makeAgentProvider(),
    model: makeAgentModel(),
    ...overrides
  } as Parameters<typeof buildAiSdkAgentParams>[0]
}

describe('buildAiSdkAgentParams — adapter resolution through the shared endpoint pipeline', () => {
  it('resolves a generic provider to the openai-compatible adapter', async () => {
    const built = await buildAiSdkAgentParams(baseInput())
    expect(built.sdkConfig.providerId).toBe('openai-compatible')
    expect(built.sdkConfig.modelId).toBe('gpt-4o')
  })

  it('resolves an Anthropic-family endpoint to the anthropic adapter', async () => {
    const built = await buildAiSdkAgentParams(
      baseInput({
        provider: makeAgentProvider({
          id: 'anthropic',
          defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
          }
        }),
        model: makeAgentModel({
          id: 'anthropic::claude-sonnet-5',
          providerId: 'anthropic',
          apiModelId: 'claude-sonnet-5'
        })
      })
    )
    expect(built.sdkConfig.providerId).toBe('anthropic')
  })

  it('resolves a Google-family endpoint to the google adapter (non-OpenAI family)', async () => {
    const built = await buildAiSdkAgentParams(
      baseInput({
        provider: makeAgentProvider({
          id: 'gemini',
          defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
          endpointConfigs: {
            [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
              adapterFamily: 'google',
              baseUrl: 'https://generativelanguage.googleapis.com'
            }
          }
        }),
        model: makeAgentModel({ id: 'gemini::gemini-2.5-pro', providerId: 'gemini', apiModelId: 'gemini-2.5-pro' })
      })
    )
    expect(built.sdkConfig.providerId).toBe('google')
  })
})

describe('buildAiSdkAgentParams — fail-closed validation', () => {
  it('rejects an api-key provider with no enabled key', async () => {
    mocks.getApiKeys.mockReturnValue([{ id: 'k1', key: '   ', isEnabled: true }])
    await expect(buildAiSdkAgentParams(baseInput())).rejects.toBeInstanceOf(AiSdkAgentMissingApiKeyError)
  })

  it('rejects a model without native function calling', async () => {
    await expect(
      buildAiSdkAgentParams(baseInput({ model: makeAgentModel({ capabilities: [] }) }))
    ).rejects.toBeInstanceOf(AiSdkAgentUnsupportedModelError)
  })

  it('rejects the managed CherryAI default model', async () => {
    await expect(
      buildAiSdkAgentParams(
        baseInput({
          provider: makeAgentProvider({ id: CHERRYAI_PROVIDER_ID }),
          model: makeAgentModel({
            id: `${CHERRYAI_PROVIDER_ID}::${CHERRYAI_DEFAULT_MODEL_ID}`,
            providerId: CHERRYAI_PROVIDER_ID,
            apiModelId: CHERRYAI_DEFAULT_MODEL_ID
          })
        })
      )
    ).rejects.toBeInstanceOf(AiSdkAgentUnsupportedModelError)
  })

  it('rejects an external-CLI-only provider', async () => {
    await expect(
      buildAiSdkAgentParams(baseInput({ provider: makeAgentProvider({ authMethods: ['external-cli'] }) }))
    ).rejects.toBeInstanceOf(AiSdkAgentUnsupportedModelError)
  })

  it('skips the key check for OAuth/IAM providers', async () => {
    mocks.getApiKeys.mockReturnValue([])
    const built = await buildAiSdkAgentParams(
      baseInput({ provider: makeAgentProvider({ authType: 'oauth', authMethods: ['oauth'] }) })
    )
    expect(built.sdkConfig).toBeDefined()
    expect(mocks.getApiKeys).not.toHaveBeenCalled()
  })
})

describe('resolveAndAssertAiSdkAgentModel', () => {
  it('resolves provider and model then asserts usability', () => {
    mocks.getByProviderId.mockReturnValue(makeAgentProvider())
    mocks.getByKey.mockReturnValue(makeAgentModel())

    const { provider, model } = resolveAndAssertAiSdkAgentModel('openai::gpt-4o')

    expect(provider.id).toBe('openai')
    expect(model.apiModelId).toBe('gpt-4o')
  })

  it('fails closed when the provider cannot be resolved', () => {
    mocks.getByProviderId.mockImplementation(() => {
      throw new Error('Provider not found')
    })
    expect(() => resolveAndAssertAiSdkAgentModel('missing::gpt-4o')).toThrowError('Provider not found')
  })
})

describe('buildAiSdkAgentParams — system prompt and options', () => {
  it('assembles instructions, workspace section, and bounded context files', async () => {
    await writeFile(path.join(workspace, 'AGENTS.md'), 'workspace rules')

    const built = await buildAiSdkAgentParams(baseInput())

    expect(built.system).toContain('Be terse.')
    expect(built.system).toContain(`Your working directory is: ${workspace}`)
    expect(built.system).toContain('workspace rules')
    expect(built.system).not.toContain('# Skills')
  })

  it('includes the skill catalog section only when skills are supplied', async () => {
    const built = await buildAiSdkAgentParams(
      baseInput({ skills: [{ name: 'PDF', description: 'Extract PDFs', folderName: 'pdf' }] })
    )
    expect(built.system).toContain('# Skills')
    expect(built.system).toContain('- PDF: Extract PDFs')
  })

  it('derives maxTurns from configuration with a documented default', async () => {
    const configured = await buildAiSdkAgentParams(
      baseInput({ agent: { id: 'agent-1', instructions: '', configuration: { max_turns: 12 } } })
    )
    expect(configured.maxTurns).toBe(12)

    const fallback = await buildAiSdkAgentParams(
      baseInput({ agent: { id: 'agent-1', instructions: '', configuration: { max_turns: -1 } } })
    )
    expect(fallback.maxTurns).toBe(DEFAULT_AI_SDK_AGENT_MAX_TURNS)
  })

  it('builds tool-repair options without telemetry when developer mode is off', async () => {
    const built = await buildAiSdkAgentParams(baseInput())

    expect(built.options.maxRetries).toBe(0)
    expect(built.options.stopWhen).toBeDefined()
    expect(built.options.repairToolCall).toBeTypeOf('function')
    expect(built.options.telemetry).toBeUndefined()
  })
})
