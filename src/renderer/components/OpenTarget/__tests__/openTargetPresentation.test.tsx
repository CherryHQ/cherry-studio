import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { ExternalOpenTarget } from '@shared/types/externalApp'

import { getOpenTargetLabel } from '../openTargetPresentation'

const t = ((key: string) => key) as TFunction

describe('getOpenTargetLabel', () => {
  it('uses the resolved application name for a system-default target', () => {
    const target: ExternalOpenTarget = {
      id: 'system_default',
      name: 'System Handler',
      kind: 'system_default'
    }

    expect(getOpenTargetLabel(target, t)).toBe('System Handler')
  })
})
