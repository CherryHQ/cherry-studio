import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { describe, expect, it } from 'vitest'

import { CODE_CLI_PACKAGE_SPECS, getCodeCliInstallSpec } from '../packages'

describe('Code CLI package compatibility views', () => {
  it.each(CODE_CLI_TOOL_PRESETS)(
    '$id: derives main-process package and install specs from the shared catalog',
    (preset) => {
      expect(getCodeCliInstallSpec(preset.id)).toEqual({ name: preset.executable, tool: preset.miseTool })
      expect(CODE_CLI_PACKAGE_SPECS[preset.id]).toEqual({
        executable: preset.executable,
        packageName: preset.packageName,
        install: preset.install
      })
    }
  )

  it('keeps the compatibility map and entries immutable', () => {
    expect(Object.isFrozen(CODE_CLI_PACKAGE_SPECS)).toBe(true)
    expect(Object.values(CODE_CLI_PACKAGE_SPECS).every((spec) => Object.isFrozen(spec))).toBe(true)
  })
})
