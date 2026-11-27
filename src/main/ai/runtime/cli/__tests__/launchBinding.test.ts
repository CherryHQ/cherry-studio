import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { resolveClaudeLaunch } from '@main/ai/runtime/claudeCode/localClaudeLaunch'
import { t } from '@main/i18n'
import { CodeCliService } from '@main/services/codeCli/CodeCliService'
import { openLocalAgentTerminal } from '@main/services/codeCli/localAgentCli'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'

import { bindLaunchModel } from '../launchBinding'
import { LocalAgentOverlayService } from '../LocalAgentOverlayService'

vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: vi.fn(async () => ({})) }))

const ADDRESS = 'port:wire-model'
const credential = { baseUrl: 'http://127.0.0.1:4100', apiKey: 'scoped-key', dispose: vi.fn() }
const createScopedCredential = vi.fn(async (): Promise<typeof credential> => credential)
const openTerminal = vi.fn(async (): Promise<{ success: boolean }> => ({ success: true }))
const installed = (name: string) => ({ [name]: { name, availability: { source: 'system', path: `/usr/bin/${name}` } } })

describe('launch model binding', () => {
  const dbh = setupTestDatabase()
  let root: string
  const overlays = () => path.join(root, 'overlays')
  const cli = new CodeCliService()
  const overlayService = new LocalAgentOverlayService()

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'launch-binding-'))
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) =>
      key === 'feature.agents.launch_overlays' ? path.join(overlays(), file ?? '') : getPath(key, file)
    )
    MockApplicationUtils.setService('CodeCliService', {
      readConfigFiles: cli.readConfigFiles.bind(cli),
      openTerminal
    })
    MockApplicationUtils.setService('BinaryManager', {
      getToolSnapshots: async () => ({ ...installed('claude'), ...installed('codex') })
    })
    MockApplicationUtils.setService('ApiGatewayService', { createScopedCredential })
    MockApplicationUtils.setService('LocalAgentOverlayService', overlayService)
    credential.dispose.mockClear()
    createScopedCredential.mockReset()
    createScopedCredential.mockResolvedValue(credential)
    openTerminal.mockReset()
    openTerminal.mockResolvedValue({ success: true })
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'port',
        name: 'Port provider',
        orderKey: 'a0',
        isEnabled: true,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://upstream.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiKeys: [{ id: 'key', key: 'upstream-secret', isEnabled: true }]
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'port::wire-model',
        providerId: 'port',
        modelId: 'wire-model',
        name: 'Wire model',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0',
        contextWindow: 32000
      })
      .run()
  })

  afterEach(async () => {
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  const config = (presetId: string, extra: Partial<LocalAgentConfiguration> = {}): LocalAgentConfiguration => ({
    presetId,
    enabled: true,
    args: [],
    env: {},
    sourceModelId: createUniqueModelId('port', 'wire-model'),
    sourceModelViaGateway: true,
    ...extra
  })

  it('serves Pi a launch home with the scoped credential while the user files stay untouched', async () => {
    const real = path.join(root, 'pi')
    await mkdir(path.join(real, 'sessions'), { recursive: true })
    const settings = '{"theme":"dark","defaultProvider":"anthropic","defaultModel":"user"}'
    await writeFile(path.join(real, 'settings.json'), settings)
    const env = { PI_CODING_AGENT_DIR: real }

    const binding = (await bindLaunchModel(config('pi-acp'), env, { sessionId: 'session', terminal: false }))!
    const home = binding.env.PI_CODING_AGENT_DIR
    expect(home).not.toBe(real)
    const launched = JSON.parse(await readFile(path.join(home, 'settings.json'), 'utf8'))
    expect(launched.theme).toBe('dark')
    const models = await readFile(path.join(home, 'models.json'), 'utf8')
    expect(models).toContain(credential.baseUrl)
    expect(models).toContain(credential.apiKey)
    expect(models).not.toContain('upstream-secret')
    expect(createScopedCredential).toHaveBeenCalledWith(
      expect.objectContaining({ model: ADDRESS, agentSessionId: 'session' })
    )
    await writeFile(path.join(home, 'sessions', 'run.jsonl'), 'kept')

    await binding.dispose()
    expect(await readFile(path.join(real, 'settings.json'), 'utf8')).toBe(settings)
    expect(await readdir(real)).toEqual(['sessions', 'settings.json'])
    expect(await readFile(path.join(real, 'sessions', 'run.jsonl'), 'utf8')).toBe('kept')
    expect(await readdir(overlays())).toEqual([])
    expect(credential.dispose).toHaveBeenCalled()
  })

  it('gives concurrent launches of one Agent their own credential and home', async () => {
    const real = path.join(root, 'pi')
    await mkdir(path.join(real, 'sessions'), { recursive: true })
    const lease = (apiKey: string) => ({ ...credential, apiKey, dispose: vi.fn() })
    const first = lease('first-key')
    const second = lease('second-key')
    createScopedCredential.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const env = { PI_CODING_AGENT_DIR: real }

    const [a, b] = await Promise.all([
      bindLaunchModel(config('pi-acp'), env, { sessionId: 'a', terminal: false }),
      bindLaunchModel(config('pi-acp'), env, { sessionId: 'b', terminal: false })
    ])
    const homes = [a!.env.PI_CODING_AGENT_DIR, b!.env.PI_CODING_AGENT_DIR]
    expect(homes[0]).not.toBe(homes[1])
    expect(await readFile(path.join(homes[0], 'models.json'), 'utf8')).toContain('first-key')
    expect(await readFile(path.join(homes[1], 'models.json'), 'utf8')).toContain('second-key')
    await writeFile(path.join(homes[0], 'sessions', 'a.jsonl'), 'a')

    await a!.dispose()
    expect(first.dispose).toHaveBeenCalled()
    expect(second.dispose).not.toHaveBeenCalled()
    expect(await readFile(path.join(homes[1], 'sessions', 'a.jsonl'), 'utf8')).toBe('a')
    await b!.dispose()
    expect(await readdir(path.join(real, 'sessions'))).toEqual(['a.jsonl'])
  })

  it('routes a scheduled Claude task to the bound model, not the provider in the user settings', async () => {
    const home = path.join(root, 'claude')
    await mkdir(home, { recursive: true })
    await writeFile(
      path.join(home, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://user.test',
          ANTHROPIC_AUTH_TOKEN: 'user-token',
          ANTHROPIC_CUSTOM_HEADERS: 'X-Org: user-secret',
          CLAUDE_CODE_USE_BEDROCK: '1'
        }
      })
    )
    const launch = await resolveClaudeLaunch(
      config('claude', { env: { CLAUDE_CONFIG_DIR: home } }),
      root,
      new AbortController().signal,
      'scheduled-chat',
      'task-session'
    )
    expect(JSON.stringify(launch.env)).not.toMatch(/user\.test|user-token|user-secret/)
    expect(launch.modelBinding?.settingsEnv).toMatchObject({
      ANTHROPIC_BASE_URL: credential.baseUrl,
      ANTHROPIC_CUSTOM_HEADERS: '',
      CLAUDE_CODE_USE_BEDROCK: '',
      ANTHROPIC_MODEL: ADDRESS
    })
    expect(createScopedCredential).toHaveBeenCalledWith(expect.objectContaining({ agentSessionId: 'task-session' }))
    await launch.modelBinding?.dispose()
  })

  it('opens a Cherry-bound Codex terminal and keeps its credential until Cherry stops', async () => {
    await openLocalAgentTerminal(config('codex'))
    const [{ args, env }] = openTerminal.mock.calls[0] as unknown as [{ args: string[]; env: Record<string, string> }]
    expect(args).toContain(`model='${ADDRESS}'`)
    expect(env.CHERRY_STUDIO_API_KEY).toBe(credential.apiKey)
    expect(credential.dispose).not.toHaveBeenCalled()

    await (overlayService as unknown as { onStop(): Promise<void> }).onStop()
    expect(credential.dispose).toHaveBeenCalled()
  })

  it.each([
    ['fails', async () => ({ success: false })],
    [
      'throws',
      async () => {
        throw new Error('no terminal')
      }
    ]
  ] as const)('releases the terminal credential when opening the terminal %s', async (_, open) => {
    openTerminal.mockImplementationOnce(open)
    await openLocalAgentTerminal(config('codex')).catch(() => undefined)
    expect(credential.dispose).toHaveBeenCalled()
  })

  it('signs in through the terminal without binding a Cherry model', async () => {
    await openLocalAgentTerminal({ ...config('codex'), login: true })
    expect(createScopedCredential).not.toHaveBeenCalled()
  })

  it('refuses a launch whose config path the home variable cannot redirect, and releases the credential', async () => {
    const data = path.join(root, 'cline-data')
    await expect(bindLaunchModel(config('cline'), { CLINE_DATA_DIR: data }, { terminal: false })).rejects.toThrow(
      t('code_cli.model.launch_home_unredirected')
    )
    expect(credential.dispose).toHaveBeenCalled()
    await expect(readdir(data)).rejects.toThrow()
  })

  it('passes Codex its provider as quoted overrides and the key through the environment only', async () => {
    const binding = (await bindLaunchModel(config('codex'), {}, { terminal: false }))!
    const overrides = binding.args.filter((_, index) => binding.args[index - 1] === '-c')
    expect(overrides).toContain(`model='${ADDRESS}'`)
    expect(overrides).toContain(`model_providers.cherry-studio.base_url='${credential.baseUrl}/v1'`)
    expect(overrides).toContain("model_providers.cherry-studio.env_key='CHERRY_STUDIO_API_KEY'")
    expect(binding.args.join(' ')).not.toContain(credential.apiKey)
    expect(binding.env).toEqual({ CHERRY_STUDIO_API_KEY: credential.apiKey })
    expect(binding.contextWindow).toBe(32000)
  })

  it('merges the OpenCode connection into config content the user already passes', async () => {
    const binding = (await bindLaunchModel(
      config('opencode'),
      { OPENCODE_CONFIG_CONTENT: '{"theme":"user","provider":{"mine":{"name":"Mine"}}}' },
      { terminal: false }
    ))!
    const content = JSON.parse(binding.env.OPENCODE_CONFIG_CONTENT)
    expect(content.theme).toBe('user')
    expect(content.provider.mine).toEqual({ name: 'Mine' })
    expect(JSON.stringify(content)).toContain(credential.baseUrl)
    expect(content.model).toContain(ADDRESS)
  })

  it('gives Claude Code flag settings in a session and a private settings file in a terminal', async () => {
    const session = (await bindLaunchModel(config('claude'), {}, { terminal: false }))!
    expect(session.settingsEnv).toMatchObject({
      ANTHROPIC_BASE_URL: credential.baseUrl,
      ANTHROPIC_AUTH_TOKEN: credential.apiKey,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: ADDRESS
    })

    const terminal = (await bindLaunchModel(config('claude'), {}, { terminal: true }))!
    const [flag, file] = terminal.args
    expect(flag).toBe('--settings')
    expect(JSON.parse(await readFile(file, 'utf8')).env).toEqual(session.settingsEnv)
    await terminal.dispose()
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })

  it.each([
    ['factory-droid', {}],
    ['hermes', {}],
    ['minimax', {}],
    ['codex', { executableOverride: '/custom/codex' }]
  ] as const)('refuses a Cherry model for %s before creating a credential', async (presetId, extra) => {
    await expect(bindLaunchModel(config(presetId, extra), {}, { terminal: false })).rejects.toThrow(
      t('code_cli.model.cherry_model_unsupported')
    )
    expect(createScopedCredential).not.toHaveBeenCalled()
  })

  it('leaves a launch alone when the Agent uses the CLI model', async () => {
    const native = config('pi-acp', { sourceModelId: undefined, sourceModelViaGateway: undefined })
    expect(await bindLaunchModel(native, {}, { terminal: false })).toBeUndefined()
  })
})
