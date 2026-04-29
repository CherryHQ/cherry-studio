import { describe, expect, it } from 'vitest'

import { buildSessionUpdateData } from '../AgentSessionService'

describe('buildSessionUpdateData', () => {
  it('includes slashCommands in session updates', () => {
    const updateData = buildSessionUpdateData(
      {
        name: 'Updated session',
        slashCommands: [{ command: '/ship', description: 'Ship it' }]
      },
      123
    )

    expect(updateData).toMatchObject({
      updatedAt: 123,
      name: 'Updated session',
      slashCommands: [{ command: '/ship', description: 'Ship it' }]
    })
  })

  it('normalizes explicit undefined fields to null', () => {
    const updateData = buildSessionUpdateData({ description: undefined }, 456)

    expect(updateData).toMatchObject({
      updatedAt: 456,
      description: null
    })
  })
})
