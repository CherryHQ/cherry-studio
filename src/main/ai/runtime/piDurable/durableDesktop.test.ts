import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { Harness } from '@earendil-works/pi-durable'
import { MemoryStorage } from '@earendil-works/pi-durable/storage/memory'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { assistantDataService } from '@data/services/AssistantService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { prepareDurableDesktop } from './durableDesktop'

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn(async (): Promise<Record<string, string>> => ({})),
  getPathFromEnvironment: () => undefined
}))

const MODEL = 'wire::default-model'

describe('Pi Durable desktop tools of a user Agent', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-durable-desktop-'))
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) => {
      if (key.startsWith('feature.agents.')) return path.join(root, key, file ?? '')
      if (key === 'feature.provider_registry.data') return path.resolve('packages/provider-registry/data', file ?? '')
      return getPath(key, file)
    })
    MockApplicationUtils.setService('McpCatalogService', { listTools: () => [] })
    MockApplicationUtils.setService('ApiGatewayService', { getInternalGatewayOrigin: () => undefined })
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
      getTurnTrustedNotifyChannels: () => undefined
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', MODEL)
    // Browser automation needs a live Electron session.
    MockMainPreferenceServiceUtils.setPreferenceValue('app.browser.agent_control.enabled', false)
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'wire',
        name: 'Wire provider',
        isEnabled: true,
        orderKey: 'a0',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: MODEL,
        providerId: 'wire',
        modelId: 'default-model',
        name: 'Default Model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
  })

  // Catches create-tool guidance that names a call the Durable model cannot make (it once sent the model to `tool_search`).
  it("reaches a user Agent's create and settings tools through the call form its prompt gives", async () => {
    const agent = agentService.createAgentWithId('weekly', {
      type: 'pi-durable',
      name: 'Weekly reports',
      instructions: 'Write my weekly report every Friday.',
      model: MODEL
    })
    fs.mkdirSync(path.join(root, 'workspace'))
    const workspace = agentWorkspaceService.findOrCreateByPath(path.join(root, 'workspace'))
    const session = agentSessionService.create({
      agentId: agent.id,
      name: 'Session',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const desktop = await prepareDurableDesktop({ sessionId: session.id, agentId: agent.id, modelId: MODEL }, () => {})
    const fake = fauxProvider({ tokensPerSecond: 100_000 })
    // The model follows only what its system prompt says: the `await tools.<name>(` calls it names.
    fake.setResponses([
      (context) => {
        const prompt = JSON.stringify(context.messages.filter((message) => message.role === 'system'))
        const named = [...prompt.matchAll(/await tools\.(mcp__\w+)\(/g)].map((match) => match[1])
        const find = (suffix: string) => named.find((name) => name.endsWith(suffix))
        const create = find('__assistant_create')
        const update = find('__config_update')
        if (!create || !update || !find('__agent_create')) return fauxAssistantMessage('No call form in the prompt.')
        const code = [
          `for (const name of ${JSON.stringify(named)}) if (!(await describeTool(name))) throw new Error('unknown ' + name)`,
          `await tools.${create}({ name: '翻译小助手', prompt: 'Translate Chinese into idiomatic English.' })`,
          `await tools.${update}({ description: 'Writes weekly reports' })`
        ].join('\n')
        return fauxAssistantMessage(fauxToolCall('codemode', { code }), { stopReason: 'toolUse' })
      },
      fauxAssistantMessage('Done.')
    ])
    const models = createModels()
    models.setProvider(fake.provider)
    const native = await Harness.open(new MemoryStorage(), { registry: desktop.registry, models }, BACKGROUND_CONTEXT)
    try {
      const conversation = await native.createConversation(
        {
          ownership: { kind: 'ownerless' },
          agent: { ...desktop.agentConfig, model: { provider: 'faux', modelId: 'faux-1' } }
        },
        BACKGROUND_CONTEXT
      )
      const submission = await conversation.submit(
        { type: 'input', content: '帮我创建一个助手：把中文翻译成地道英文，名字叫“翻译小助手”。', requestId: 'create' },
        BACKGROUND_CONTEXT
      )
      native.resume()
      await submission.wait(BACKGROUND_CONTEXT)

      const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, BACKGROUND_CONTEXT)
      const result = entries.items
        .flatMap((entry) => entry.model ?? [])
        .find((message) => message.role === 'toolResult' && message.toolName === 'codemode')
      expect(result, 'the model made no codemode call').toMatchObject({ isError: false })
      expect(assistantDataService.list({ page: 1, limit: 100 }).items.map((assistant) => assistant.name)).toContain(
        '翻译小助手'
      )
      expect(agentService.getAgent(agent.id)?.description).toBe('Writes weekly reports')
    } finally {
      await native.close(BACKGROUND_CONTEXT)
      await desktop.close()
    }
  })
})
