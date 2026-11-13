import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', () => ({
  application: { get: () => ({ search: () => [] }) }
}))

import { READ_FILE_TOOL_NAME } from '@shared/ai/builtinTools'

import { ToolRegistry } from '../../registry'
import { registerBuiltinTools } from '../registerBuiltinTools'

describe('registerBuiltinTools', () => {
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
