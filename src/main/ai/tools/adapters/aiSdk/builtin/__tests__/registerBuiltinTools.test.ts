import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', () => ({
  application: { get: () => ({ search: () => [] }) }
}))

import {
  FS_READ_TOOL_NAME,
  MCP_RESOURCE_LIST_TOOL_NAME,
  MCP_RESOURCE_READ_TOOL_NAME,
  READ_FILE_TOOL_NAME
} from '@shared/ai/builtinTools'

import { ToolRegistry } from '../../registry'
import { KB_LIST_TOOL_NAME } from '../KnowledgeListTool'
import { KB_MANAGE_TOOL_NAME } from '../KnowledgeManageTool'
import { KB_READ_TOOL_NAME } from '../KnowledgeReadTool'
import { KB_SEARCH_TOOL_NAME } from '../KnowledgeSearchTool'
import { GENERATE_IMAGE_TOOL_NAME } from '../PaintingTool'
import { registerBuiltinTools } from '../registerBuiltinTools'
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

describe('registerBuiltinTools', () => {
  it('populates the given registry with every builtin entry', () => {
    const reg = new ToolRegistry()
    registerBuiltinTools(reg)
    expect(reg.has(KB_LIST_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_SEARCH_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_READ_TOOL_NAME)).toBe(true)
    expect(reg.has(KB_MANAGE_TOOL_NAME)).toBe(true)
    expect(reg.has(READ_FILE_TOOL_NAME)).toBe(true)
    expect(reg.has(GENERATE_IMAGE_TOOL_NAME)).toBe(true)
    expect(reg.has(WEB_FETCH_TOOL_NAME)).toBe(true)
    expect(reg.has(WEB_SEARCH_TOOL_NAME)).toBe(true)
    expect(reg.has(FS_READ_TOOL_NAME)).toBe(true)
    expect(reg.has(MCP_RESOURCE_LIST_TOOL_NAME)).toBe(true)
    expect(reg.has(MCP_RESOURCE_READ_TOOL_NAME)).toBe(true)
  })

  it('never marks a builtin tool `strict` (strict schemas share one compile budget)', () => {
    // `strict` asks the provider for constrained decoding, so Anthropic compiles every strict tool
    // schema in the request into one sampling grammar and 400s the request ("Schema is too complex
    // for compilation") once the combined grammar exceeds its compile budget. Binding a knowledge
    // base alone turned on four strict tools at once and broke every message, including "hi".
    // Asserted registry-wide rather than on the kb_* four: the budget is undocumented and shared, so
    // "this tool is small enough to be strict" is a judgement that would need re-checking on every
    // added tool and property. A blanket rule needs none.
    // The AI SDK still validates tool calls against the zod schema, and `createAiRepair` re-asks the
    // model on a mismatch, so nothing is silently unvalidated.
    const reg = new ToolRegistry()
    registerBuiltinTools(reg)
    const strictEntries = reg.getAll().filter((e) => e.tool.strict === true)
    expect(strictEntries.map((e) => e.name)).toEqual([])
    // Sanity: the assertion above is only meaningful while the registry is actually populated.
    expect(reg.getAll().length).toBeGreaterThan(0)
  })

  it('gates read_file on file attachments', () => {
    const reg = new ToolRegistry()
    registerBuiltinTools(reg)
    const readFile = reg.getByName(READ_FILE_TOOL_NAME)
    expect(readFile?.applies?.({ mcpToolIds: new Set(), hasFileAttachments: false })).toBe(false)
    expect(readFile?.applies?.({ mcpToolIds: new Set(), hasFileAttachments: true })).toBe(true)
  })

  it(
    'never defers an approval-gated entry (would strip it from the inline set with no way back — ' +
      'see mcp/mcpTools.ts and toolInvoke.ts for the same rule on MCP force-prompt tools)',
    () => {
      const reg = new ToolRegistry()
      registerBuiltinTools(reg)
      for (const entry of reg.getAll()) {
        if (entry.tool.needsApproval) {
          expect(entry.defer).toBe('never')
        }
      }
      // Sanity: this loop is only meaningful while at least one builtin entry is approval-gated.
      expect(reg.getAll().some((e) => e.tool.needsApproval)).toBe(true)
    }
  )
})
