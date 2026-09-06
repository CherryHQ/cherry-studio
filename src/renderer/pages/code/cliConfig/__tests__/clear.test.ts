import { CodeCli } from '@shared/types/codeCli'
import type { CliConfigTarget, CliConfigWriteFile } from '@shared/utils/cliConfig'
import { CLI_CONFIG_FILE_SPECS } from '@shared/utils/cliConfig'
import { parse as parseToml } from 'smol-toml'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { clearCliConfig } from '../index'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

let existing: Record<string, string>
let writes: Record<string, string>
let deletes: string[]
const resolvedSpecPath = (target: CliConfigTarget) => `/resolved${CLI_CONFIG_FILE_SPECS[target].path}`
const hermesConfigPath = resolvedSpecPath('hermes-config')
const hermesEnvPath = resolvedSpecPath('hermes-env')

beforeEach(() => {
  existing = {}
  writes = {}
  deletes = []
  // Clearing still reads the on-disk configs renderer-side (code_cli.read_config)
  // to strip the Cherry-managed keys; only the rewrite crosses to write_config.
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (route: string, input: Record<string, unknown>) => {
    if (route === 'code_cli.read_config') {
      // Translate target path specs to deterministic `/resolved…` fixture paths.
      return {
        files: (input.targets as CliConfigTarget[]).map((target) => {
          const resolvedPath = resolvedSpecPath(target)
          return { target, path: resolvedPath, content: resolvedPath in existing ? existing[resolvedPath] : null }
        })
      }
    }
    for (const file of input.files as CliConfigWriteFile[]) {
      const resolvedPath = resolvedSpecPath(file.target)
      if ('delete' in file) deletes.push(resolvedPath)
      else writes[resolvedPath] = file.content
    }
    return { success: true }
  })
})

describe('clearCliConfig', () => {
  it('claude: strips managed top-level + env keys, keeps user keys', async () => {
    existing['/resolved~/.claude/settings.json'] = JSON.stringify({
      userTop: 'keep',
      effortLevel: 'high',
      permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(ls)'] },
      env: { ANTHROPIC_BASE_URL: 'x', ANTHROPIC_AUTH_TOKEN: 'y', USER_ENV: 'keep' }
    })

    await clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE })

    expect(JSON.parse(writes['/resolved~/.claude/settings.json'])).toEqual({
      userTop: 'keep',
      permissions: { allow: ['Bash(ls)'] },
      env: { USER_ENV: 'keep' }
    })
  })

  it('codex: strips cherry provider + model + goals + auth key, keeps user entries', async () => {
    existing['/resolved~/.codex/config.toml'] = [
      'model = "gpt-5"',
      'model_provider = "cherry-deepseek"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      'default_permissions = ":danger-full-access"',
      'model_reasoning_effort = "high"',
      'user_key = "keep"',
      '[model_providers.cherry-deepseek]',
      'base_url = "https://api.deepseek.com/v1"',
      '[model_providers.userprov]',
      'base_url = "https://user.example"',
      '[features]',
      'goals = true',
      'other = true'
    ].join('\n')
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk',
      tokens: {
        id_token: 'oauth-id-token',
        access_token: 'oauth-access',
        refresh_token: 'oauth-refresh',
        account_id: 'account-id'
      },
      last_refresh: '2026-08-08T00:00:00.000Z',
      user: 'keep'
    })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(parseToml(writes['/resolved~/.codex/config.toml'])).toEqual({
      user_key: 'keep',
      model_providers: { userprov: { base_url: 'https://user.example' } },
      features: { other: true }
    })
    expect(JSON.parse(writes['/resolved~/.codex/auth.json'])).toEqual({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: 'oauth-id-token',
        access_token: 'oauth-access',
        refresh_token: 'oauth-refresh',
        account_id: 'account-id'
      },
      last_refresh: '2026-08-08T00:00:00.000Z',
      user: 'keep'
    })
  })

  it('codex: deletes stale API-key auth when no official login can be restored', async () => {
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({ auth_mode: 'apikey' })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(writes['/resolved~/.codex/auth.json']).toBeUndefined()
    expect(deletes).toContain('/resolved~/.codex/auth.json')
  })

  it('codex: deletes legacy key-only auth instead of leaving a false ChatGPT login', async () => {
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({ OPENAI_API_KEY: 'sk' })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(writes['/resolved~/.codex/auth.json']).toBeUndefined()
    expect(deletes).toContain('/resolved~/.codex/auth.json')
  })

  it('codex: deletes auth with incomplete OAuth tokens instead of restoring ChatGPT mode', async () => {
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk',
      tokens: { access_token: 'oauth-access' }
    })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(writes['/resolved~/.codex/auth.json']).toBeUndefined()
    expect(deletes).toContain('/resolved~/.codex/auth.json')
  })

  it('codex: deletes auth when complete OAuth tokens have no last refresh timestamp', async () => {
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk',
      tokens: {
        id_token: 'oauth-id-token',
        access_token: 'oauth-access',
        refresh_token: 'oauth-refresh'
      }
    })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(writes['/resolved~/.codex/auth.json']).toBeUndefined()
    expect(deletes).toContain('/resolved~/.codex/auth.json')
  })

  it('opencode: strips only cherry-* providers and the cherry-addressed top-level model', async () => {
    existing['/resolved~/.config/opencode/opencode.json'] = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: 'cherry-deepseek/deepseek-chat',
      provider: { 'cherry-deepseek': { npm: 'x' }, userprov: { npm: 'y' } },
      autoCompact: true,
      compaction: { auto: true, prune: false, reserved: 10000 },
      maxTurns: 30,
      permission: 'ask',
      userTop: 'keep'
    })

    await clearCliConfig({ cliTool: CodeCli.OPEN_CODE })

    expect(JSON.parse(writes['/resolved~/.config/opencode/opencode.json'])).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: { userprov: { npm: 'y' } },
      compaction: { prune: false, reserved: 10000 },
      userTop: 'keep'
    })
  })

  // The top-level model is only Cherry's when it addresses a cherry-* provider; a user's own
  // selector pointing at their own provider must survive the clear.
  it('opencode: keeps a user-owned top-level model', async () => {
    existing['/resolved~/.config/opencode/opencode.json'] = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: 'userprov/gpt-4o',
      provider: { 'cherry-deepseek': { npm: 'x' }, userprov: { npm: 'y' } }
    })

    await clearCliConfig({ cliTool: CodeCli.OPEN_CODE })

    expect(JSON.parse(writes['/resolved~/.config/opencode/opencode.json'])).toEqual({
      $schema: 'https://opencode.ai/config.json',
      model: 'userprov/gpt-4o',
      provider: { userprov: { npm: 'y' } }
    })
  })

  it('gemini: strips security.auth.selectedType when config exists', async () => {
    existing['/resolved~/.gemini/settings.json'] = JSON.stringify({
      general: { vimMode: true, userSetting: 'keep' },
      model: { name: 'gemini-2.5-pro' },
      security: { auth: { selectedType: 'gemini-api-key' } }
    })

    await clearCliConfig({ cliTool: CodeCli.GEMINI_CLI })

    expect(JSON.parse(writes['/resolved~/.gemini/settings.json'])).toEqual({
      general: { userSetting: 'keep' }
    })
  })

  it('gemini: scrubs managed env keys from .env while preserving user comments and entries', async () => {
    existing['/resolved~/.gemini/.env'] =
      '# my proxy\nUSER_KEY=keep\nGEMINI_API_KEY=sk-secret\nGOOGLE_GEMINI_BASE_URL=https://x\n'

    await clearCliConfig({ cliTool: CodeCli.GEMINI_CLI })

    expect(writes['/resolved~/.gemini/.env']).toBe('# my proxy\nUSER_KEY=keep\n')
  })

  it('qwen: missing config is already clear and sends no rewrite', async () => {
    await clearCliConfig({ cliTool: CodeCli.QWEN_CODE })

    expect(mocks.request.mock.calls.some(([route]) => route === 'code_cli.write_config')).toBe(false)
  })

  it('qwen: strips managed settings when config exists', async () => {
    existing['/resolved~/.qwen/settings.json'] = JSON.stringify({
      env: { CHERRY_QWEN_API_KEY: 'sk', USER_ENV: 'keep' },
      general: { vimMode: true, userSetting: 'keep' },
      tools: { approvalMode: 'yolo', userTool: 'keep' },
      model: 'qwen3-max',
      security: { auth: { selectedType: 'openai' } },
      modelProviders: {
        openai: [
          { id: 'qwen3-max', envKey: 'CHERRY_QWEN_API_KEY' },
          { id: 'user-model', envKey: 'USER_API_KEY' }
        ]
      }
    })

    await clearCliConfig({ cliTool: CodeCli.QWEN_CODE })

    expect(JSON.parse(writes['/resolved~/.qwen/settings.json'])).toEqual({
      env: { USER_ENV: 'keep' },
      general: { userSetting: 'keep' },
      tools: { userTool: 'keep' },
      modelProviders: {
        openai: [{ id: 'user-model', envKey: 'USER_API_KEY' }]
      }
    })
  })

  it('kimi: missing config is already clear and sends no rewrite', async () => {
    await clearCliConfig({ cliTool: CodeCli.KIMI_CODE })

    expect(mocks.request.mock.calls.some(([route]) => route === 'code_cli.write_config')).toBe(false)
  })

  it('kimi: strips Cherry-managed entries when config exists', async () => {
    existing['/resolved~/.kimi-code/config.toml'] = [
      'default_model = "cherry-DeepSeek"',
      'default_permission_mode = "auto"',
      'user_key = "keep"',
      '',
      '[providers.cherry-DeepSeek]',
      'type = "openai"',
      '',
      '[providers.userprov]',
      'type = "openai"',
      '',
      '[models.cherry-DeepSeek]',
      'provider = "cherry-DeepSeek"',
      '',
      '[models.user-model]',
      'provider = "userprov"',
      ''
    ].join('\n')

    await clearCliConfig({ cliTool: CodeCli.KIMI_CODE })

    expect(parseToml(writes['/resolved~/.kimi-code/config.toml'])).toEqual({
      user_key: 'keep',
      providers: { userprov: { type: 'openai' } },
      models: { 'user-model': { provider: 'userprov' } }
    })
  })

  it('hermes: strips only the Cherry-managed custom runtime and credential', async () => {
    existing[hermesConfigPath] = [
      '# user-owned comment',
      'user_top: keep',
      'model:',
      '  context_length: 200000 # keep inline comment',
      '  label: "keep quoted"',
      '  tags: [one, two]',
      '  provider: custom',
      '  default: cherry-model',
      '  base_url: https://api.example.com/v1',
      '  api_key: ${CHERRY_HERMES_API_KEY}',
      '  api_mode: chat_completions',
      'shared: &shared { enabled: true }',
      'reuse: *shared',
      ''
    ].join('\n')
    existing[hermesEnvPath] = 'USER_KEY=keep\nCHERRY_HERMES_API_KEY=sk-secret\n'

    await clearCliConfig({ cliTool: CodeCli.HERMES })

    expect(parseYaml(writes[hermesConfigPath])).toEqual({
      user_top: 'keep',
      model: { context_length: 200000, label: 'keep quoted', tags: ['one', 'two'] },
      shared: { enabled: true },
      reuse: { enabled: true }
    })
    expect(writes[hermesConfigPath]).toContain('# user-owned comment')
    expect(writes[hermesConfigPath]).toContain('context_length: 200000 # keep inline comment')
    expect(writes[hermesConfigPath]).toContain('label: "keep quoted"')
    expect(writes[hermesConfigPath]).toContain('tags: [ one, two ]')
    expect(writes[hermesConfigPath]).toContain('shared: &shared { enabled: true }')
    expect(writes[hermesConfigPath]).toContain('reuse: *shared')
    expect(writes[hermesEnvPath]).toBe('USER_KEY=keep\n')
  })

  it('pi: strips Cherry-managed providers and defaults while preserving user config', async () => {
    existing['/resolved~/.pi/agent/models.json'] = JSON.stringify({
      userTop: 'keep',
      providers: {
        'cherry-gateway': { apiKey: 'cs-sk-secret' },
        user: { baseUrl: 'https://user.example' }
      }
    })
    existing['/resolved~/.pi/agent/settings.json'] = JSON.stringify({
      theme: 'light',
      defaultProvider: 'cherry-gateway',
      defaultModel: 'deepseek:deepseek-chat'
    })

    await clearCliConfig({ cliTool: CodeCli.PI })

    expect(JSON.parse(writes['/resolved~/.pi/agent/models.json'])).toEqual({
      userTop: 'keep',
      providers: { user: { baseUrl: 'https://user.example' } }
    })
    expect(JSON.parse(writes['/resolved~/.pi/agent/settings.json'])).toEqual({ theme: 'light' })
  })

  it('is a no-op for tools without a managed config file (openclaw)', async () => {
    await clearCliConfig({ cliTool: CodeCli.OPENCLAW })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  // Cleared configs still hold non-Cherry secrets — they must be rewritten through the same
  // transactional main-process writer as applies (0600 + rollback are pinned in configWriter tests).
  it("rewrites all of a tool's files in one code_cli.write_config batch", async () => {
    existing['/resolved~/.codex/config.toml'] = 'model_provider = "cherry-deepseek"\nuser_key = "keep"'
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({ OPENAI_API_KEY: 'sk', user: 'keep' })
    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    const writeCalls = mocks.request.mock.calls.filter(([route]) => route === 'code_cli.write_config')
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][1]).toEqual({
      cliTool: CodeCli.OPENAI_CODEX,
      files: [
        { target: 'codex-config', content: expect.stringContaining('user_key = "keep"') },
        { target: 'codex-auth', delete: true }
      ]
    })
  })

  it('throws the main-process failure message when the rewrite is rejected', async () => {
    existing['/resolved~/.codex/config.toml'] = 'model_provider = "cherry-deepseek"'
    mocks.request.mockImplementation(async (route: string, input: Record<string, unknown>) => {
      if (route === 'code_cli.write_config') return { success: false, message: 'disk full' }
      return {
        files: (input.targets as CliConfigTarget[]).map((target) => {
          const resolvedPath = `/resolved${CLI_CONFIG_FILE_SPECS[target].path}`
          return { target, path: resolvedPath, content: resolvedPath in existing ? existing[resolvedPath] : null }
        })
      }
    })

    await expect(clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })).rejects.toThrow('disk full')
  })

  // S6: clear must never overwrite a config it can't fully understand — a malformed on-disk file
  // should abort the whole operation rather than silently rewriting it as if it were empty.
  describe('aborts instead of overwriting a malformed existing config file', () => {
    it('claude: rejects and writes nothing', async () => {
      existing['/resolved~/.claude/settings.json'] = '{ not valid json'
      await expect(clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('codex: rejects and writes nothing (config.toml malformed, secret redacted)', async () => {
      existing['/resolved~/.codex/config.toml'] = 'api_key = "sk-ant-real-secret"\nbroken====='
      existing['/resolved~/.codex/auth.json'] = JSON.stringify({ OPENAI_API_KEY: 'sk', user: 'keep' })
      await expect(clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })).rejects.toThrow(/Failed to parse/)
      await expect(clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })).rejects.not.toThrow(/sk-ant-real-secret/)
      expect(writes).toEqual({})
    })

    it('opencode: rejects and writes nothing', async () => {
      existing['/resolved~/.config/opencode/opencode.json'] = '{ not valid json'
      await expect(clearCliConfig({ cliTool: CodeCli.OPEN_CODE })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('gemini: rejects and writes nothing (settings.json malformed)', async () => {
      existing['/resolved~/.gemini/settings.json'] = '{ not valid json'
      await expect(clearCliConfig({ cliTool: CodeCli.GEMINI_CLI })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('qwen: rejects and writes nothing', async () => {
      existing['/resolved~/.qwen/settings.json'] = '{ not valid json'
      await expect(clearCliConfig({ cliTool: CodeCli.QWEN_CODE })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('kimi: rejects and writes nothing', async () => {
      existing['/resolved~/.kimi-code/config.toml'] = 'broken====='
      await expect(clearCliConfig({ cliTool: CodeCli.KIMI_CODE })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('pi: rejects and writes nothing', async () => {
      existing['/resolved~/.pi/agent/models.json'] = '{ not valid json'
      await expect(clearCliConfig({ cliTool: CodeCli.PI })).rejects.toThrow(/Failed to parse/)
      expect(writes).toEqual({})
    })

    it('hermes: rejects and writes nothing', async () => {
      existing[hermesConfigPath] = 'api_key: "sk-ant-real-secret"\n  malformed: yaml'
      await expect(clearCliConfig({ cliTool: CodeCli.HERMES })).rejects.toThrow(/Failed to parse/)
      await expect(clearCliConfig({ cliTool: CodeCli.HERMES })).rejects.not.toThrow(/sk-ant-real-secret/)
      expect(writes).toEqual({})
    })
  })
})
