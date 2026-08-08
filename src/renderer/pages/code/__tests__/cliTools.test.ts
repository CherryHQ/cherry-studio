import { CodeCli, LOGIN_CAPABLE_CLI_TOOLS } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { CLI_TOOLS, PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'

describe('CLI_TOOLS', () => {
  it('exposes every CodeCli enum value with a renderable icon component', () => {
    const expectedValues = Object.values(CodeCli)
    const actualValues = CLI_TOOLS.map((tool) => tool.value)

    expect(actualValues.sort()).toEqual([...expectedValues].sort())

    for (const tool of CLI_TOOLS) {
      expect(typeof tool.icon).toBe('function')
    }
  })
})

describe('LOGIN_CAPABLE_CLI_TOOLS', () => {
  it('covers exactly the tools that offer the virtual own-login option', () => {
    expect([...LOGIN_CAPABLE_CLI_TOOLS].sort()).toEqual(
      [
        CodeCli.CLAUDE_CODE,
        CodeCli.OPENAI_CODEX,
        CodeCli.GEMINI_CLI,
        CodeCli.QWEN_CODE,
        CodeCli.KIMI_CODE,
        CodeCli.PI
      ].sort()
    )
  })

  it('never overlaps the fully providerless tools', () => {
    for (const tool of PROVIDERLESS_CLI_TOOLS) {
      expect(LOGIN_CAPABLE_CLI_TOOLS.has(tool)).toBe(false)
    }
  })
})
