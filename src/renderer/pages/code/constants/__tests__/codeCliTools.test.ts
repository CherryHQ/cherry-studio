import { describe, expect, it } from 'vitest'

// Deliberate cross-process deep import (test-only): the renderer install table
// (miseTool) and the main-process acquisition table describe the same packages,
// but no type links them — this test is that link. Lives on the renderer side
// because main files (tests included) must not import renderer code.
import { CODE_CLI_PACKAGE_SPECS, getCodeCliInstallSpec } from '../../../../../main/services/codeCli/packages'
import { CLI_TOOL_PRESETS } from '../codeCliTools'

describe('CLI_TOOL_PRESETS ↔ CODE_CLI_PACKAGE_SPECS consistency', () => {
  it('covers exactly the same set of CLI tools', () => {
    expect(new Set(CLI_TOOL_PRESETS.map((preset) => preset.id))).toEqual(new Set(Object.keys(CODE_CLI_PACKAGE_SPECS)))
  })

  it.each(CLI_TOOL_PRESETS)('$id: miseTool matches the main-process install spec', (preset) => {
    expect(preset.miseTool).toBe(getCodeCliInstallSpec(preset.id).tool)
  })
})
