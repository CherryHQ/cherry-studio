import '@data/services/AgentGlobalSkillService'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
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
  const originalWrite = application.get('CodeCliService').writeConfigFiles
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'cherry-global-model-'))
    vi.mocked(application.getPath).mockImplementation((_key, filename) => path.join(home, filename ?? ''))
    application.get('CodeCliService').updateConfigFiles = service.updateConfigFiles.bind(service)
    application.get('CodeCliService').writeConfigFiles = service.writeConfigFiles.bind(service)
  })
  afterAll(async () => {
    application.get('CodeCliService').updateConfigFiles = originalUpdate
    application.get('CodeCliService').writeConfigFiles = originalWrite
    await rm(home, { recursive: true, force: true })
  })

  function createLocalAgent(id: string, name: string, config: Partial<LocalAgentConfiguration>) {
    return agentService.createAgentWithId(id, {
      name,
      type: 'local',
      model: null,
      configuration: { localRuntime: { enabled: true, args: [], env: {}, ...config } }
    })
  }

  it.each([
    ['antigravity-acp', 'gemini'],
    ['cursor', 'composer']
  ] as const)('stores and clears the %s model on the Agent', async (presetId, model) => {
    const config = { presetId, enabled: true, args: [], env: {} }
    const agent = createLocalAgent(`local-${presetId}`, presetId, config)
    await selectLocalAgentModel(agent.id, model)
    await expect(
      selectLocalAgentModel(agent.id, undefined, {
        expectedFiles: [{ target: 'pi-settings', content: '{}' }]
      })
    ).rejects.toThrow(t('code_cli.model.unsupported'))
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe(model)
    await selectLocalAgentModel(agent.id)
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime).toEqual(config)
  })

  it.each([
    ['claude', '.claude/settings.json', '{"model":"sonnet","env":{"ANTHROPIC_MODEL":"sonnet"}}\n'],
    ['codex', '.codex/config.toml', 'model = "gpt-5.4"\n']
  ] as const)(
    'changes and clears the %s chat override without editing native model configuration',
    async (presetId, file, original) => {
      const filename = path.join(home, file)
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, original)
      const config = { presetId, enabled: true, args: [], env: {} }
      const agent = createLocalAgent(`local-${presetId}`, presetId, config)

      await selectLocalAgentModel(agent.id, 'explicit')
      expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('explicit')
      expect(await readFile(filename, 'utf8')).toBe(original)

      await selectLocalAgentModel(agent.id)
      expect(agentService.getAgent(agent.id)?.configuration?.localRuntime).toEqual(config)
      expect(await readFile(filename, 'utf8')).toBe(original)
    }
  )

  it('applies Code Mate provider changes to the existing chat Agent', () => {
    const agent = createLocalAgent('provider-agent', 'Pi', {
      presetId: 'pi-acp',
      nativeModel: 'old/model'
    })
    syncLocalAgentConfigModel(CodeCli.PI, [
      { target: 'pi-settings', content: '{"defaultProvider":"custom","defaultModel":"new"}' }
    ])
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('custom/new')
  })

  it('does not project global config edits onto an Agent with a separate config root', () => {
    const agent = createLocalAgent('independent-claude', 'Separate Claude', {
      presetId: 'claude',
      env: { CLAUDE_CONFIG_DIR: '/independent' },
      nativeModel: 'private-model'
    })
    expect(
      syncLocalAgentConfigModel(
        CodeCli.CLAUDE_CODE,
        [{ target: 'claude-settings', content: '{"model":"global-model","effortLevel":"high"}' }],
        false,
        {}
      )
    ).toBeUndefined()
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('private-model')
  })

  it('keeps the Poolside native model on the Agent and refuses a Cherry model it cannot bind', async () => {
    const [file] = await service.readConfigFiles(['poolside-settings'])
    await mkdir(path.dirname(file.path), { recursive: true })
    await writeFile(file.path, 'model: user\n')
    const agent = createLocalAgent('local-poolside', 'Poolside', { presetId: 'poolside' })
    await selectLocalAgentModel(agent.id, 'poolside/laguna-xs-2.1')
    await expect(
      selectLocalAgentModel(agent.id, undefined, {
        sourceModelId: createUniqueModelId('provider', 'test'),
        sourceModelViaGateway: true
      })
    ).rejects.toThrow(t('code_cli.model.cherry_model_unsupported'))
    expect(await readFile(file.path, 'utf8')).toBe('model: user\n')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('poolside/laguna-xs-2.1')
  })

  it.each([
    ['qwen', 'qwen-settings', '{"model":{"name":"user-model"}}'],
    ['kilo', 'kilo-config', '{"model":"user/model"}'],
    ['copilot', 'copilot-settings', '{"model":"user-model"}'],
    ['mistral-vibe', 'vibe-config', 'active_model = "user"\n'],
    ['claude', 'claude-settings', '{"env":{"ANTHROPIC_MODEL":"user"}}'],
    ['codex', 'codex-config', 'model = "user"\n']
  ] as const)(
    'stores a %s Cherry model on the Agent alone and leaves the CLI files untouched',
    async (presetId, target, content) => {
      const [file] = await service.readConfigFiles([target])
      await mkdir(path.dirname(file.path), { recursive: true })
      await writeFile(file.path, content)
      const agent = createLocalAgent(`cherry-${presetId}`, presetId, { presetId, nativeModel: 'native' })
      const sourceModelId = createUniqueModelId('provider', 'model')

      const selected = await selectLocalAgentModel(agent.id, undefined, { sourceModelId, sourceModelViaGateway: true })
      expect(selected.configuration?.localRuntime).toMatchObject({ sourceModelId, sourceModelViaGateway: true })
      expect(selected.configuration?.localRuntime?.nativeModel).toBeUndefined()
      expect(await readFile(file.path, 'utf8')).toBe(content)

      const restored = await selectLocalAgentModel(agent.id)
      expect(restored.configuration?.localRuntime?.sourceModelId).toBeUndefined()
      expect(restored.configuration?.localRuntime?.sourceModelViaGateway).toBeUndefined()
    }
  )

  it.each([
    ['factory-droid', { sourceModelViaGateway: true }],
    ['pi-acp', { sourceModelViaGateway: false }]
  ] as const)('rejects a %s Cherry model it cannot bind at launch', async (presetId, selection) => {
    const agent = createLocalAgent(`unbound-${presetId}`, presetId, { presetId, nativeModel: 'native' })
    await expect(
      selectLocalAgentModel(agent.id, undefined, {
        sourceModelId: createUniqueModelId('provider', 'model'),
        ...selection
      })
    ).rejects.toThrow(t('code_cli.model.cherry_model_unsupported'))
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('native')
  })

  it('does not change the saved model when native persistence is unsupported', async () => {
    const agent = createLocalAgent('custom-local', 'Custom', {
      executableOverride: '/custom/acp',
      nativeModel: 'previous'
    })
    await expect(selectLocalAgentModel(agent.id, 'next')).rejects.toThrow(t('code_cli.model.unsupported'))
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('previous')
  })
  it('rejects stale drafts without overwriting disk or the saved selection', async () => {
    const agent = createLocalAgent('stale-pi', 'Pi', { presetId: 'pi-acp' })
    await selectLocalAgentModel(agent.id, 'anthropic/first')
    await expect(
      selectLocalAgentModel(agent.id, 'anthropic/second', {
        expectedFiles: [{ target: 'pi-settings', content: null }]
      })
    ).rejects.toThrow('configuration changed')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('anthropic/first')
    expect(JSON.parse(await readFile(path.join(home, '.pi/agent/settings.json'), 'utf8')).defaultModel).toBe('first')
  })

  it('edits the Poolside model with an unrelated CLI override and refuses an override of its own model', async () => {
    const agent = createLocalAgent('poolside-model-env', 'Poolside', {
      presetId: 'poolside',
      env: { CODEX_HOME: '/other/codex' }
    })
    await selectLocalAgentModel(agent.id, 'selected')
    agentService.updateAgent(agent.id, {
      configuration: { localRuntime: { env: { POOLSIDE_STANDALONE_MODEL: 'external' } } }
    })
    await expect(selectLocalAgentModel(agent.id, 'replaced')).rejects.toThrow(t('code_cli.model.environment_mismatch'))
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('selected')
  })

  it('selects the Codex model when only the Cline data directory differs', async () => {
    const agent = createLocalAgent('codex-independent-env', 'Codex', {
      presetId: 'codex',
      env: { CLINE_DATA_DIR: '/other/cline' }
    })
    const selected = await selectLocalAgentModel(agent.id, 'next')
    expect(selected.configuration?.localRuntime?.nativeModel).toBe('next')
  })

  it('checks editor drafts inside the queue so concurrent writes cannot share a stale snapshot', async () => {
    const agent = createLocalAgent('queued-pi', 'Pi', { presetId: 'pi-acp' })
    const original = '{"defaultProvider":"native","defaultModel":"original"}'
    await service.writeConfigFiles({
      cliTool: CodeCli.PI,
      files: [{ target: 'pi-settings', content: original }]
    })
    const writes = await Promise.allSettled(
      ['first', 'second'].map((model) =>
        service.writeConfigFiles({
          cliTool: CodeCli.PI,
          files: [
            { target: 'pi-settings', content: JSON.stringify({ defaultProvider: 'native', defaultModel: model }) }
          ],
          expectedFiles: [{ target: 'pi-settings', content: original }]
        })
      )
    )

    expect(writes[0].status).toBe('fulfilled')
    expect(writes[1]).toMatchObject({ status: 'rejected', reason: new Error(t('code_cli.config_changed')) })
    expect(JSON.parse(await readFile(path.join(home, '.pi/agent/settings.json'), 'utf8')).defaultModel).toBe('first')
    expect(agentService.getAgent(agent.id)?.configuration?.localRuntime?.nativeModel).toBe('native/first')
  })

  it('keeps an Agent-owned Cherry model when the global CLI config changes', async () => {
    const sourceModelId = createUniqueModelId('custom', 'example')
    const agent = createLocalAgent('editor-cherry', 'Claude', {
      presetId: 'claude',
      sourceModelId,
      sourceModelViaGateway: true
    })
    const content = '{"model":"global","effortLevel":"high"}'
    await service.writeConfigFiles({ cliTool: CodeCli.CLAUDE_CODE, files: [{ target: 'claude-settings', content }] })

    expect(await readFile(path.join(home, '.claude/settings.json'), 'utf8')).toBe(content)
    const runtime = agentService.getAgent(agent.id)?.configuration?.localRuntime
    expect(runtime).toMatchObject({ sourceModelId, sourceModelViaGateway: true })
    expect(runtime?.nativeModel).toBeUndefined()
  })

  it('retains model source for parameter edits and rejects an editor draft after an external edit', async () => {
    const sourceModelId = createUniqueModelId('custom', 'example')
    const agent = createLocalAgent('editor-claude', 'Claude', {
      presetId: 'claude',
      nativeModel: 'example',
      sourceModelId
    })
    const original = '{"env":{"ANTHROPIC_MODEL":"example"},"effortLevel":"medium"}'
    await service.writeConfigFiles({
      cliTool: CodeCli.CLAUDE_CODE,
      files: [{ target: 'claude-settings', content: original }],
      preserveModelSource: true
    })
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
