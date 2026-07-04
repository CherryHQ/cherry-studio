import { CodeCli } from '@shared/types/codeCli'
import { parse as parseToml } from 'smol-toml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCliConfig } from '../index'

let existing: Record<string, string>
let writes: Record<string, string>

beforeEach(() => {
  existing = {}
  writes = {}
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      resolvePath: vi.fn(async (p: string) => `/resolved${p}`),
      file: {
        readExternal: vi.fn(async (p: string) => {
          if (p in existing) return existing[p]
          throw new Error(`File does not exist: ${p}`)
        }),
        mkdir: vi.fn(async () => undefined),
        write: vi.fn(async (p: string, content: string) => {
          writes[p] = content
        })
      }
    }
  })
})

describe('clearCliConfig', () => {
  it('claude: strips managed top-level + env keys, keeps user keys', async () => {
    existing['/resolved~/.claude/settings.json'] = JSON.stringify({
      userTop: 'keep',
      permissions: { managed: true },
      env: { ANTHROPIC_BASE_URL: 'x', ANTHROPIC_AUTH_TOKEN: 'y', USER_ENV: 'keep' }
    })

    await clearCliConfig({ cliTool: CodeCli.CLAUDE_CODE })

    expect(JSON.parse(writes['/resolved~/.claude/settings.json'])).toEqual({
      userTop: 'keep',
      env: { USER_ENV: 'keep' }
    })
  })

  it('codex: strips cherry provider + model + goals + auth key, keeps user entries', async () => {
    existing['/resolved~/.codex/config.toml'] = [
      'model = "gpt-5"',
      'model_provider = "cherry-deepseek"',
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
    existing['/resolved~/.codex/auth.json'] = JSON.stringify({ OPENAI_API_KEY: 'sk', user: 'keep' })

    await clearCliConfig({ cliTool: CodeCli.OPENAI_CODEX })

    expect(parseToml(writes['/resolved~/.codex/config.toml'])).toEqual({
      user_key: 'keep',
      model_providers: { userprov: { base_url: 'https://user.example' } },
      features: { other: true }
    })
    expect(JSON.parse(writes['/resolved~/.codex/auth.json'])).toEqual({ user: 'keep' })
  })

  it('opencode: strips only cherry-* providers', async () => {
    existing['/resolved~/.config/opencode/opencode.json'] = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: { 'cherry-deepseek': { npm: 'x' }, userprov: { npm: 'y' } },
      userTop: 'keep'
    })

    await clearCliConfig({ cliTool: CodeCli.OPEN_CODE })

    expect(JSON.parse(writes['/resolved~/.config/opencode/opencode.json'])).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: { userprov: { npm: 'y' } },
      userTop: 'keep'
    })
  })

  it('qwen: missing config is already clear and does not create files', async () => {
    await clearCliConfig({ cliTool: CodeCli.QWEN_CODE })

    expect(writes).toEqual({})
    expect(window.api.file.mkdir).not.toHaveBeenCalled()
    expect(window.api.file.write).not.toHaveBeenCalled()
  })

  it('qwen: strips managed settings when config exists', async () => {
    existing['/resolved~/.qwen/settings.json'] = JSON.stringify({
      env: { CHERRY_QWEN_API_KEY: 'sk', USER_ENV: 'keep' },
      general: { vimMode: true, userSetting: 'keep' },
      model: 'qwen3-max',
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
      modelProviders: {
        openai: [{ id: 'user-model', envKey: 'USER_API_KEY' }]
      }
    })
  })

  it('kimi: missing config is already clear and does not create files', async () => {
    await clearCliConfig({ cliTool: CodeCli.KIMI_CODE })

    expect(writes).toEqual({})
    expect(window.api.file.mkdir).not.toHaveBeenCalled()
    expect(window.api.file.write).not.toHaveBeenCalled()
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

  it('is a no-op for tools without a managed config file (openclaw)', async () => {
    await clearCliConfig({ cliTool: CodeCli.OPENCLAW })
    expect(writes).toEqual({})
  })
})
