import { describe, expect, it } from 'vitest'

import { canOfferPlanMode, hasPlanIntent } from '../planModeHint'

describe('hasPlanIntent', () => {
  it.each([
    'make a plan for refactoring',
    'Plan this refactor',
    'PLANNING the week',
    '计划一下未来一周的工作',
    '帮我规划一下',
    '先做个计划'
  ])('detects %s', (text) => expect(hasPlanIntent(text)).toBe(true))

  it.each(['explain the airplane', 'planet', 'plans', 'hello'])('ignores %s', (text) =>
    expect(hasPlanIntent(text)).toBe(false)
  )
})

describe('canOfferPlanMode', () => {
  it('offers for claude-code agents outside plan mode', () => {
    expect(canOfferPlanMode({ type: 'claude-code', configuration: { permission_mode: 'default' } } as never)).toBe(true)
  })

  it('does not offer when already planning, for Cherry Assistant, or for runtimes without plan mode', () => {
    expect(canOfferPlanMode({ type: 'claude-code', configuration: { permission_mode: 'plan' } } as never)).toBe(false)
    expect(canOfferPlanMode({ type: 'claude-code', configuration: { builtin_role: 'assistant' } } as never)).toBe(false)
    expect(canOfferPlanMode({ type: 'pi', configuration: {} } as never)).toBe(false)
    expect(canOfferPlanMode(undefined)).toBe(false)
  })
})
