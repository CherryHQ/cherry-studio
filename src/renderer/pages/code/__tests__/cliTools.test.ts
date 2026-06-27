import { codeCLI } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { CLI_TOOLS } from '../cliTools'

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
