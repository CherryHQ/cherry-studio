import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/application', () => ({
  application: { get: () => ({ search: () => [] }) }
}))

import { ToolRegistry } from '../../registry'
import { KB_GREP_TOOL_NAME } from '../KnowledgeGrepTool'
import { KB_LIST_TOOL_NAME } from '../KnowledgeListTool'
import { KB_MANAGE_TOOL_NAME } from '../KnowledgeManageTool'
import { KB_READ_TOOL_NAME } from '../KnowledgeReadTool'
import { KB_SEARCH_TOOL_NAME } from '../KnowledgeSearchTool'
import { KB_TREE_TOOL_NAME } from '../KnowledgeTreeTool'
import { registerBuiltinTools } from '../index'
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

describe('registerBuiltinTools', () => {
  it('populates the given registry with every builtin entry', () => {
    const reg = new ToolRegistry()
    registerBuiltinTools(reg)
    expect(reg.has(KB_LIST_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_SEARCH_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_READ_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_GREP_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_TREE_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_MANAGE_TOOL_NAME)).toBe(true)
    expect(reg.has(WEB_FETCH_TOOL_NAME)).toBe(true)
    expect(reg.has(WEB_SEARCH_TOOL_NAME)).toBe(true)
  })
})
