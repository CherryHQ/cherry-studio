import { CODE_CLI_TOOL_PRESETS } from '@shared/data/presets/codeCliTools'
import { describe, expect, it } from 'vitest'

import { CLI_TOOL_PRESETS } from '../codeCliTools'

describe('Code CLI renderer presets', () => {
  it('derives every id and mise spec from the shared acquisition catalog', () => {
    expect(CLI_TOOL_PRESETS).toEqual(CODE_CLI_TOOL_PRESETS.map(({ id, miseTool }) => ({ id, miseTool })))
  })
})
