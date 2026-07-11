import { CodeCli } from '@shared/types/codeCli'
import { FILE_CONFIGURED_CLI_TOOLS, getCliConfigTargets } from '@shared/utils/cliConfig'
import { describe, expect, it } from 'vitest'

import { CLI_CONFIG_ADAPTERS, type CliConfigAdapter, getAdapter } from '../adapters'

/**
 * Guards the central adapter registry: the whole point of consolidating the
 * per-CLI `switch` statements into `CLI_CONFIG_ADAPTERS` is that adding a new
 * file-based CLI is a single new adapter — these assertions fail loudly if that
 * adapter is missing, incomplete, or drifts from the shared target table.
 */
// Every non-optional method of CliConfigAdapter (buildOwnLoginDraft is the sole optional one).
const REQUIRED_METHODS = [
  'providerBaseUrls',
  'sanitize',
  'buildDraft',
  'assertCredentials',
  'updateDraftConfig',
  'buildClearFiles',
  'extractConnection',
  'extractConfig'
] as const satisfies readonly (keyof CliConfigAdapter)[]

// Own-login exposes a config panel for every file tool except OpenCode.
const OWN_LOGIN_CONFIGURABLE_TOOLS = new Set<string>([
  CodeCli.CLAUDE_CODE,
  CodeCli.OPENAI_CODEX,
  CodeCli.GEMINI_CLI,
  CodeCli.QWEN_CODE,
  CodeCli.KIMI_CODE
])

describe('CLI_CONFIG_ADAPTERS registry', () => {
  const adapterKeys = Object.keys(CLI_CONFIG_ADAPTERS)

  it('covers exactly the file-configured CLI tools', () => {
    expect(new Set(adapterKeys)).toEqual(FILE_CONFIGURED_CLI_TOOLS)
  })

  it.each(adapterKeys)('%s adapter implements every required method', (cliTool) => {
    const adapter = getAdapter(cliTool)
    expect(adapter).toBeDefined()
    for (const method of REQUIRED_METHODS) {
      expect(typeof adapter?.[method]).toBe('function')
    }
  })

  it.each(adapterKeys)('%s adapter targets match the shared target table', (cliTool) => {
    expect(getAdapter(cliTool)?.targets).toEqual(getCliConfigTargets(cliTool))
  })

  it.each(adapterKeys)('%s adapter exposes buildOwnLoginDraft only when own-login configurable', (cliTool) => {
    expect(typeof getAdapter(cliTool)?.buildOwnLoginDraft === 'function').toBe(
      OWN_LOGIN_CONFIGURABLE_TOOLS.has(cliTool)
    )
  })

  it('returns undefined for CLI tools without a config file', () => {
    expect(getAdapter(CodeCli.OPENCLAW)).toBeUndefined()
    expect(getAdapter(CodeCli.QODER_CLI)).toBeUndefined()
    expect(getAdapter('nonexistent-cli')).toBeUndefined()
  })
})
