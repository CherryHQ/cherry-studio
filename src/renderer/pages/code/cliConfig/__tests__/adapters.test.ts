import { describe, expect, it } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'
import { FILE_CONFIGURED_CLI_TOOLS, getActiveCliConfigTargets, getCliConfigTargets } from '@shared/utils/cliConfig'

import { CLI_CONFIG_ADAPTERS, getAdapter } from '../adapters'

// Own-login exposes a config panel only when the tool has managed settings beyond provider/model selection.
const OWN_LOGIN_CONFIGURABLE_TOOLS = new Set<string>([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

describe('CLI_CONFIG_ADAPTERS registry', () => {
  const adapterKeys = Object.keys(CLI_CONFIG_ADAPTERS)

  it('selects only the active Claude destination while retaining ownership of both', () => {
    expect(getCliConfigTargets(CodeCli.CLAUDE_CODE)).toEqual(['claude-settings', 'claude-scoped-settings'])
    expect(getActiveCliConfigTargets(CodeCli.CLAUDE_CODE)).toEqual(['claude-settings'])
    expect(getActiveCliConfigTargets(CodeCli.CLAUDE_CODE, true)).toEqual(['claude-scoped-settings'])
    expect(getActiveCliConfigTargets(CodeCli.OPENAI_CODEX, true)).toEqual(getCliConfigTargets(CodeCli.OPENAI_CODEX))
  })

  it('covers exactly the file-configured CLI tools', () => {
    expect(new Set(adapterKeys)).toEqual(FILE_CONFIGURED_CLI_TOOLS)
  })

  it.each(adapterKeys)('%s adapter targets match the shared target table', (cliTool) => {
    expect(getAdapter(cliTool)?.targets).toEqual(getCliConfigTargets(cliTool))
  })

  it.each(adapterKeys)('%s adapter exposes buildOwnLoginDraft only when own-login configurable', (cliTool) => {
    expect(typeof getAdapter(cliTool)?.buildOwnLoginDraft === 'function').toBe(
      OWN_LOGIN_CONFIGURABLE_TOOLS.has(cliTool)
    )
  })

  it('strips credentials and models from a generated own-login blob while preserving other keys', async () => {
    const adapter = getAdapter(CodeCli.CLAUDE_CODE)!
    const files = await adapter.buildOwnLoginDraft!(
      {
        env: {
          ANTHROPIC_BASE_URL: 'url',
          ANTHROPIC_AUTH_TOKEN: 'token',
          ANTHROPIC_API_KEY: 'key',
          ANTHROPIC_MODEL: 'model',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'model',
          USER_KEY: 'keep'
        },
        custom: 'keep'
      },
      true,
      [{ target: 'claude-scoped-settings', content: '{}', path: '/settings', format: 'json', label: 'settings' } as any]
    )
    expect(JSON.parse(files[0].content)).toEqual({ custom: 'keep', env: { USER_KEY: 'keep' } })
  })

  it('returns undefined for CLI tools without a config file', () => {
    expect(getAdapter(CodeCli.OPENCLAW)).toBeUndefined()
    expect(getAdapter(CodeCli.QODER_CLI)).toBeUndefined()
    expect(getAdapter('nonexistent-cli')).toBeUndefined()
  })
})
