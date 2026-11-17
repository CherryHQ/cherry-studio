import { describe, expect, it } from 'vitest'

import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE } from '@shared/data/presets/codeCliTools'

describe('Code CLI executable lookup', () => {
  it.each([
    'constructor',
    'toString',
    'toLocaleString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable'
  ])('does not classify the custom executable %s as a built-in Code CLI', (name) => {
    expect(CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[name]).toBeUndefined()
  })
})
