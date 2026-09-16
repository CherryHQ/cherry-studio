import { describe, expect, it } from 'vitest'

import { renderAgentEntityIcon } from '../resourceEntityIcon'

describe('renderAgentEntityIcon', () => {
  it('does not render an icon when the icon type is none', () => {
    expect(renderAgentEntityIcon('none', { type: 'pi' })).toBeUndefined()
  })
})
