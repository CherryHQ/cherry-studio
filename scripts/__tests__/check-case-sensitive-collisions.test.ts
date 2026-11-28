import { describe, expect, test } from 'vitest'

import { findCaseOnlyStemCollisions } from '../check-case-sensitive-collisions'

describe('findCaseOnlyStemCollisions', () => {
  test('flags the #23890 PlanModeHint component/hook pair', () => {
    const collisions = findCaseOnlyStemCollisions([
      'src/renderer/components/composer/variants/agent/PlanModeHint.tsx',
      'src/renderer/components/composer/variants/agent/planModeHint.ts'
    ])
    expect(collisions).toEqual([
      [
        'src/renderer/components/composer/variants/agent/PlanModeHint.tsx',
        'src/renderer/components/composer/variants/agent/planModeHint.ts'
      ]
    ])
  })

  test('ignores byte-identical stems that resolve by extension priority everywhere', () => {
    expect(
      findCaseOnlyStemCollisions([
        'src/renderer/pages/settings/UsageSettings/__tests__/UsageSettings.test.ts',
        'src/renderer/pages/settings/UsageSettings/__tests__/UsageSettings.test.tsx'
      ])
    ).toEqual([])
  })

  test('ignores non-resolvable companions such as stylesheets', () => {
    expect(
      findCaseOnlyStemCollisions([
        'src/renderer/components/ModelSpeedControl.css',
        'src/renderer/components/ModelSpeedControl.tsx'
      ])
    ).toEqual([])
  })

  test('ignores identical stems in different directories', () => {
    expect(findCaseOnlyStemCollisions(['src/a/planModeHint.ts', 'src/b/PlanModeHint.ts'])).toEqual([])
  })

  test('flags declaration files that collide with a differently-cased source stem', () => {
    expect(findCaseOnlyStemCollisions(['src/types/Foo.d.ts', 'src/types/foo.ts'])).toEqual([
      ['src/types/Foo.d.ts', 'src/types/foo.ts']
    ])
  })

  test('returns no collisions for an empty file list', () => {
    expect(findCaseOnlyStemCollisions([])).toEqual([])
  })
})
