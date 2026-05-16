import { describe, expect, it } from 'vitest'

import { buildResetToolingUpdate } from '../../shared'

describe('buildResetToolingUpdate', () => {
  it('removes MCP servers and restores non-MCP tool defaults for the selected mode', () => {
    const update = buildResetToolingUpdate('acceptEdits', [
      { id: 'Read', name: 'Read', type: 'builtin' },
      { id: 'Write', name: 'Write', type: 'builtin', requirePermissions: true },
      { id: 'mcp__example__search', name: 'search', type: 'mcp', requirePermissions: true },
      { id: 'CustomTool', name: 'CustomTool', type: 'custom', requirePermissions: true }
    ])

    expect(update.mcps).toEqual([])
    expect(update.allowed_tools).toEqual([
      'Read',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Write',
      'Bash(mkdir:*)',
      'Bash(touch:*)',
      'Bash(rm:*)',
      'Bash(mv:*)',
      'Bash(cp:*)'
    ])
  })
})
