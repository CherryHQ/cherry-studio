import { describe, expect, it } from 'vitest'

import { colorizeShellCommandOutput, shellColorPalettes } from '../terminalOutputHelpers'

describe('colorizeShellCommandOutput', () => {
  it('colors the command without treating ordinary output lines as shell commands', () => {
    const result = colorizeShellCommandOutput(
      '> pnpm test',
      'Running test suite\n12 tests passed',
      shellColorPalettes.dark
    )

    expect(result).toContain(`${shellColorPalettes.dark.command}pnpm`)
    expect(result).not.toContain(`${shellColorPalettes.dark.command}Running`)
    expect(result).not.toContain(`${shellColorPalettes.dark.command}tests`)
  })
})
