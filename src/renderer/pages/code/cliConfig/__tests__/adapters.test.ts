import { describe, expect, it } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'
import { FILE_CONFIGURED_CLI_TOOLS, getCliConfigTargets } from '@shared/utils/cliConfig'

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

  it('returns undefined for CLI tools without a config file', () => {
    expect(getAdapter(CodeCli.OPENCLAW)).toBeUndefined()
    expect(getAdapter(CodeCli.QODER_CLI)).toBeUndefined()
    expect(getAdapter('nonexistent-cli')).toBeUndefined()
  })
})
