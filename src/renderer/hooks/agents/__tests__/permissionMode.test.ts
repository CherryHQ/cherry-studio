import type { Tool } from '@shared/ai/tool'
import { describe, expect, it } from 'vitest'

import {
  computeModeDefaults,
  mergeAutoApprovedTools,
  mergePermissionModeTools,
  normalizeAllowedToolRules
} from '../permissionMode'

const tools: Tool[] = [
  {
    id: 'Read',
    name: 'Read',
    origin: 'builtin',
    approval: 'auto'
  },
  {
    id: 'Edit',
    name: 'Edit',
    origin: 'builtin',
    approval: 'prompt'
  },
  {
    id: 'Bash',
    name: 'Bash',
    origin: 'builtin',
    approval: 'prompt'
  },
  {
    id: 'CustomDanger',
    name: 'Custom danger',
    origin: 'internal',
    approval: 'prompt'
  }
]

describe('permissionMode helpers', () => {
  it('uses resolved auto tools from the main-side policy', () => {
    expect(computeModeDefaults('default', tools)).toEqual(['Read'])
  })

  it('normalizes user-added tool names to runtime rules without adding mode defaults', () => {
    expect(mergePermissionModeTools(['Read', 'CustomDanger'], 'default', 'acceptEdits', tools)).toEqual([
      'Read',
      'CustomDanger'
    ])
  })

  it('combines explicit approvals with resolved auto tools for rendering', () => {
    expect(mergeAutoApprovedTools(['Edit'], 'default', tools)).toEqual(['Edit', 'Read'])
  })

  it('preserves Claude runtime-native pattern rules and drops non-native rules', () => {
    expect(normalizeAllowedToolRules(['Read', 'not-native:Edit', 'Bash(git *)'], tools)).toEqual([
      'Read',
      'Bash(git *)'
    ])
  })
})
