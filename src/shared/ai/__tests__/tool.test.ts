import { describe, expect, it } from 'vitest'

import { isPlanExitToolName } from '../tool'

describe('isPlanExitToolName', () => {
  it('classifies the plan-exit tool of each runtime', () => {
    expect(isPlanExitToolName('ExitPlanMode')).toBe(true)
    expect(isPlanExitToolName('exit_plan_mode')).toBe(true)
  })

  it('ignores surrounding whitespace but nothing else', () => {
    expect(isPlanExitToolName('  ExitPlanMode  ')).toBe(true)
    expect(isPlanExitToolName('ExitPlanModee')).toBe(false)
    expect(isPlanExitToolName('exit_plan_mode_helper')).toBe(false)
    expect(isPlanExitToolName('Bash')).toBe(false)
    expect(isPlanExitToolName('')).toBe(false)
  })
})
