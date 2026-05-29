import type { Tool } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { computeModeDefaults, mergePermissionModeTools } from '../permissionMode'

const tools: Tool[] = [
  { id: 'Read', name: 'Read', type: 'builtin' },
  { id: 'Edit', name: 'Edit', type: 'builtin', requirePermissions: true },
  { id: 'Bash(rm:*)', name: 'Remove', type: 'builtin', requirePermissions: true },
  { id: 'CustomDanger', name: 'Custom danger', type: 'custom', requirePermissions: true }
]

describe('permissionMode helpers', () => {
  it.each([
    ['default', ['Read']],
    ['plan', ['Read']],
    [
      'acceptEdits',
      [
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
      ]
    ],
    ['bypassPermissions', ['Read', 'Edit', 'Bash(rm:*)', 'CustomDanger']]
  ] as const)('computes defaults for %s mode', (mode, expected) => {
    expect(computeModeDefaults(mode, tools)).toEqual(expected)
  })

  it('keeps user-added tools while replacing defaults across mode transitions', () => {
    expect(mergePermissionModeTools(['Read', 'CustomDanger'], 'default', 'acceptEdits', tools)).toEqual([
      'CustomDanger',
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

  it('removes previous acceptEdits defaults when moving back to default', () => {
    expect(
      mergePermissionModeTools(['Read', 'Edit', 'Write', 'CustomDanger'], 'acceptEdits', 'default', tools)
    ).toEqual(['CustomDanger', 'Read'])
  })
})
