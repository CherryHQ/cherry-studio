import '@data/services/AgentGlobalSkillService'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import type * as Platform from '@main/core/platform'
import { t } from '@main/i18n'
import { codeCliHandlers } from '@main/ipc/handlers/codeCli'
import { CodeCliService } from '@main/services/codeCli/CodeCliService'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { createUniqueModelId } from '@shared/data/types/model'
import { CodeCli } from '@shared/types/codeCli'

import { selectLocalAgentModel, syncLocalAgentConfigModel } from '../selectModel'

const platform = vi.hoisted(() => ({ isWin: process.platform === 'win32' }))
vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  get isWin() {
    return platform.isWin
  }
}))
vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: vi.fn(async () => ({})) }))

describe('global local agent model selection', () => {
  setupTestDatabase()
  let home: string
  const service = new CodeCliService()
  const originalUpdate = application.get('CodeCliService').updateConfigFiles
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'cherry-global-model-'))
    vi.mocked(application.getPath).mockImplementation((_key, filename) => path.join(home, filename ?? ''))
    application.get('CodeCliService').updateConfigFiles = service.updateConfigFiles.bind(service)
  })
  afterAll(async () => {
    application.get('CodeCliService').updateConfigFiles = originalUpdate
    await rm(home, { recursive: true, force: true })
  })

  it('saves the same default to native config and the Agent, including concurrent selections', async () => {
    const config = { presetId: 'codex', protocol: 'codex' as const, enabled: true, args: [], env: {} }
    const agent = agentService.createAgentWithId('local-codex', {
      name: 'Codex',
      type: 'local',
      model: null,
      configuration: { localRuntime: config }
    })
    await Promise.all([selectLocalAgentModel(agent.id, 'first'), selectLocalAgentModel(agent.id, 'second')])
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime).toEqual({ ...config, nativeModel: 'second' })
    expect(await readFile(path.join(home, '.codex/config.toml'), 'utf8')).toContain('model = "second"')
  })

  it('applies Code Mate provider changes to the existing chat Agent', () => {
    const agent = agentService.createAgentWithId('provider-agent', {
      name: 'Pi',
      type: 'local',
      model: null,
      configuration: {
        localRuntime: {
          presetId: 'pi-acp',
          protocol: 'acp',
          enabled: true,
          args: [],
          env: {},
          nativeModel: 'old/model'
        }
      }
    })
    syncLocalAgentConfigModel(CodeCli.PI, [
      { target: 'pi-settings', content: '{"defaultProvider":"custom","defaultModel":"new"}' }
    ])
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('custom/new')
  })

  it('keeps Poolside native and gateway defaults consistent with the saved Agent', async () => {
    const agent = agentService.createAgentWithId('local-poolside', {
      name: 'Poolside',
      type: 'local',
      model: null,
      configuration: { localRuntime: { presetId: 'poolside', protocol: 'acp', enabled: true, args: [], env: {} } }
    })
    await selectLocalAgentModel(agent.id, 'poolside/laguna-xs-2.1')
    expect((await service.readConfigFiles(['poolside-settings']))[0].content).toContain('model: poolside/laguna-xs-2.1')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('poolside/laguna-xs-2.1')
    const gateway =
      'pool:\n  api_url: https://native.test/v1\n  default_agent_server: cherry-poolside\nagent_servers:\n  cherry-poolside:\n    default_config_options:\n      model: provider:test\n'
    const selected = await selectLocalAgentModel(agent.id, undefined, {
      sourceModelId: createUniqueModelId('provider', 'test'),
      sourceModelViaGateway: true,
      files: [{ target: 'poolside-settings', content: gateway }]
    })
    expect(selected.configuration?.localRuntime).toMatchObject({
      nativeModel: 'provider:test',
      sourceModelViaGateway: true
    })
    const restored = await selectLocalAgentModel(agent.id, 'poolside/laguna-s-2.1', {
      files: [{ target: 'poolside-settings', content: 'pool:\n  api_url: https://native.test/v1\n' }]
    })
    expect(restored.configuration?.localRuntime?.sourceModelId).toBeUndefined()
    expect((await service.readConfigFiles(['poolside-settings']))[0].content).not.toContain('cherry-poolside')
    expect(restored.configuration?.localRuntime?.nativeModel).toBe('poolside/laguna-s-2.1')
  })

  it.each([
    ['kilo', 'kilo-config', '{"model":"cherry-gateway/provider:model"}', 'cherry-gateway/provider:model'],
    ['copilot', 'copilot-settings', '{"model":"cherry-gateway/provider:model"}', 'cherry-gateway/provider:model'],
    [
      'factory-droid',
      'factory-settings',
      '{"sessionDefaultSettings":{"model":"custom:provider:model"}}',
      'custom:provider:model'
    ],
    ['mistral-vibe', 'vibe-config', 'active_model="cherry-gateway"', 'cherry-gateway']
  ] as const)('synchronizes %s global config and chat model identity', async (presetId, target, content, expected) => {
    const agent = agentService.createAgentWithId(`new-${presetId}`, {
      name: presetId,
      type: 'local',
      model: null,
      configuration: { localRuntime: { presetId, protocol: 'acp', enabled: true, args: [], env: {} } }
    })
    const selected = await selectLocalAgentModel(agent.id, undefined, {
      sourceModelId: createUniqueModelId('provider', 'model'),
      sourceModelViaGateway: true,
      files: [{ target, content }]
    })
    expect(selected.configuration?.localRuntime?.nativeModel).toBe(expected)
    const saved = await service.readConfigFiles([target])
    expect(saved[0].content).toBe(content)
    const restored = await selectLocalAgentModel(agent.id, 'native-model', {
      files: [{ target, content: target === 'vibe-config' ? '' : '{}' }]
    })
    expect(restored.configuration?.localRuntime).toMatchObject({ nativeModel: 'native-model' })
    expect(restored.configuration?.localRuntime?.sourceModelId).toBeUndefined()
  })

  it('does not change the saved model when native persistence is unsupported', async () => {
    const agent = agentService.createAgentWithId('custom-local', {
      name: 'Custom',
      type: 'local',
      model: null,
      configuration: { localRuntime: { protocol: 'acp', enabled: true, args: [], env: {}, nativeModel: 'previous' } }
    })
    await expect(selectLocalAgentModel(agent.id, 'next')).rejects.toThrow(t('code_cli.model.unsupported'))
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('previous')
  })
  it.each([false, true])(
    'commits model source (gateway: %s) and restores native selection without leftovers',
    async (viaGateway) => {
      const agent = agentService.createAgentWithId('unified-pi', {
        name: 'Pi',
        type: 'local',
        model: null,
        configuration: { localRuntime: { presetId: 'pi-acp', protocol: 'acp', enabled: true, args: [], env: {} } }
      })
      const sourceModelId = createUniqueModelId('custom', 'model-a')
      const selected = await selectLocalAgentModel(agent.id, undefined, {
        sourceModelId,
        sourceModelViaGateway: viaGateway,
        files: [
          {
            target: 'pi-settings',
            content: JSON.stringify({ defaultProvider: 'cherry-custom', defaultModel: 'model-a', theme: 'dark' })
          },
          {
            target: 'pi-models',
            content: JSON.stringify({
              providers: { 'cherry-custom': { baseUrl: 'https://example.test', apiKey: 'test-key' } }
            })
          }
        ]
      })
      expect(selected.configuration?.localRuntime).toMatchObject({
        sourceModelId,
        nativeModel: 'cherry-custom/model-a'
      })
      expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.sourceModelViaGateway).toBe(viaGateway)
      const modelsPath = path.join(home, '.pi/agent/models.json')
      expect(JSON.parse(await readFile(modelsPath, 'utf8')).providers['cherry-custom'].apiKey).toBe('test-key')
      await expect(selectLocalAgentModel(agent.id, 'anthropic/claude-sonnet-4-6')).rejects.toThrow(
        t('code_cli.model.provider_clear_required')
      )
      const restored = await selectLocalAgentModel(agent.id, 'anthropic/claude-sonnet-4-6', {
        files: [
          { target: 'pi-settings', content: '{"theme":"dark"}' },
          { target: 'pi-models', content: '{"providers":{}}' }
        ]
      })
      expect(restored.configuration?.localRuntime?.sourceModelId).toBeUndefined()
      expect(restored.configuration?.localRuntime?.sourceModelViaGateway).toBeUndefined()
      expect(JSON.parse(await readFile(path.join(home, '.pi/agent/settings.json'), 'utf8'))).toEqual({
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4-6',
        theme: 'dark'
      })
      expect(JSON.parse(await readFile(modelsPath, 'utf8')).providers).toEqual({})
    }
  )

  it('rejects stale drafts without overwriting disk or the saved selection', async () => {
    const agent = agentService.createAgentWithId('stale-pi', {
      name: 'Pi',
      type: 'local',
      model: null,
      configuration: { localRuntime: { presetId: 'pi-acp', protocol: 'acp', enabled: true, args: [], env: {} } }
    })
    await selectLocalAgentModel(agent.id, 'anthropic/first')
    await expect(
      selectLocalAgentModel(agent.id, 'anthropic/second', {
        expectedFiles: [{ target: 'pi-settings', content: null }]
      })
    ).rejects.toThrow('configuration changed')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('anthropic/first')
    expect(JSON.parse(await readFile(path.join(home, '.pi/agent/settings.json'), 'utf8')).defaultModel).toBe('first')
  })

  it('rejects a mixed-case Windows home override before writing a model to the wrong directory', async () => {
    const agent = agentService.createAgentWithId('windows-env-model', {
      name: 'Codex',
      type: 'local',
      model: null,
      configuration: {
        localRuntime: {
          presetId: 'codex',
          protocol: 'codex',
          enabled: true,
          args: [],
          env: { Codex_Home: '/different/home' }
        }
      }
    })
    platform.isWin = true
    vi.mocked(getRawShellEnv).mockResolvedValue({ codex_home: '/terminal/home' })
    try {
      await expect(selectLocalAgentModel(agent.id, 'next')).rejects.toThrow(t('code_cli.model.environment_mismatch'))
      expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBeUndefined()
    } finally {
      platform.isWin = process.platform === 'win32'
      vi.mocked(getRawShellEnv).mockResolvedValue({})
    }
  })
  it('retains model source for parameter edits and rejects an editor draft after an external edit', async () => {
    const sourceModelId = createUniqueModelId('custom', 'example')
    const agent = agentService.createAgentWithId('editor-claude', {
      name: 'Claude',
      type: 'local',
      model: null,
      configuration: {
        localRuntime: {
          presetId: 'claude',
          protocol: 'claude',
          enabled: true,
          args: [],
          env: {},
          nativeModel: 'example',
          sourceModelId
        }
      }
    })
    const original = '{"env":{"ANTHROPIC_MODEL":"example"},"effortLevel":"medium"}'
    await service.writeConfigFiles(CodeCli.CLAUDE_CODE, [{ target: 'claude-settings', content: original }])
    const input = {
      cliTool: CodeCli.CLAUDE_CODE as const,
      files: [{ target: 'claude-settings' as const, content: original.replace('medium', 'high') }],
      expectedFiles: [{ target: 'claude-settings' as const, content: original }],
      preserveModelSource: true
    }
    expect(await codeCliHandlers['code_cli.write_config'](input, { senderId: 'test' })).toEqual({ success: true })
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.sourceModelId).toBe(sourceModelId)
    const result = await codeCliHandlers['code_cli.write_config'](
      { ...input, files: [{ target: 'claude-settings', content: '{}' }] },
      { senderId: 'test' }
    )
    expect(result.success).toBe(false)
    expect(JSON.parse(await readFile(path.join(home, '.claude/settings.json'), 'utf8')).effortLevel).toBe('high')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.sourceModelId).toBe(sourceModelId)
  })
})
