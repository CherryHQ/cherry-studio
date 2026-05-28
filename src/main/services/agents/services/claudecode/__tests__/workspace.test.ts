import { describe, expect, it } from 'vitest'

import { applyWorkspaceRoot } from '../workspace'

describe('applyWorkspaceRoot', () => {
  it('sets WORKSPACE_ROOT from cwd', () => {
    const env = applyWorkspaceRoot({}, 'C:/workspace')
    expect(env.WORKSPACE_ROOT).toBe('C:/workspace')
  })

  it('does nothing when cwd is missing', () => {
    const env = applyWorkspaceRoot({ KEEP: 'yes' })
    expect(env).toEqual({ KEEP: 'yes' })
  })
})
