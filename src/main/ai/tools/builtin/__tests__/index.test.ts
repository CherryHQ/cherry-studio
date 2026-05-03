import '@test-helpers/setupBashWasm'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/application', () => ({
  application: { get: () => ({ search: () => [] }) }
}))

import { ToolRegistry } from '../../registry'
import { registerBuiltinTools } from '../index'
import { KB_SEARCH_TOOL_NAME } from '../KnowledgeSearchTool'
import { WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

describe('registerBuiltinTools', () => {
  it('populates the given registry with every builtin entry', () => {
    const reg = new ToolRegistry()
    registerBuiltinTools(reg)
    expect(reg.has(KB_SEARCH_TOOL_NAME)).toBe(true)
    expect(reg.has(WEB_SEARCH_TOOL_NAME)).toBe(true)
  })
})
