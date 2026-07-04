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
        readExternal: vi.fn(async (p: string) => existing[p] ?? ''),
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

  it('is a no-op for tools without a managed config file (openclaw)', async () => {
    await clearCliConfig({ cliTool: CodeCli.OPENCLAW })
    expect(writes).toEqual({})
  })
})
