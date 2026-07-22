import { describe, expect, it } from 'vitest'

import {
  CHERRY_META_TOOL_NAMES,
  CHERRY_TOOL_EXEC_TOOL_NAME,
  CHERRY_TOOL_INSPECT_TOOL_NAME,
  CHERRY_TOOL_INVOKE_TOOL_NAME,
  CHERRY_TOOL_SEARCH_TOOL_NAME,
  toCherryClientToolName
} from '../cherryClientToolName'

describe('Cherry AI SDK client tool names', () => {
  it('prefixes builtin function names', () => {
    expect(toCherryClientToolName('web_search')).toBe('cherry_web_search')
    expect(toCherryClientToolName('kb_search')).toBe('cherry_kb_search')
  })

  it('prefixes every meta-tool function name', () => {
    expect(CHERRY_META_TOOL_NAMES).toEqual([
      CHERRY_TOOL_SEARCH_TOOL_NAME,
      CHERRY_TOOL_INSPECT_TOOL_NAME,
      CHERRY_TOOL_INVOKE_TOOL_NAME,
      CHERRY_TOOL_EXEC_TOOL_NAME
    ])
    expect(CHERRY_META_TOOL_NAMES.every((name) => name.startsWith('cherry_'))).toBe(true)
  })
})
