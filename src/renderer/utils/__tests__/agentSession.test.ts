import { describe, expect, it } from 'vitest'

import { getChannelTypeIcon } from '../agentSession'

describe('getChannelTypeIcon', () => {
  it.each(['constructor', '__proto__', 'toString'])(
    'does not return an inherited member as an icon: %s',
    (channelType) => {
      expect(getChannelTypeIcon(channelType)).toBeUndefined()
    }
  )
})
