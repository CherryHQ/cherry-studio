import { expectTypeOf, it } from 'vitest'

import type { AgentChannelListQuery } from '../schemas/agentChannels'
import type { ApiQuery } from '../types'

it('retains optional query fields for handlers without inventing queries for other endpoints', () => {
  expectTypeOf<ApiQuery<'/agent-channels', 'GET'>>().toEqualTypeOf<AgentChannelListQuery>()
  expectTypeOf<ApiQuery<'/agent-channels', 'POST'>>().toEqualTypeOf<never>()
})
